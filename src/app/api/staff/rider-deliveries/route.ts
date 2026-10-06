import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { staffSupabase } from "@/lib/supabase";
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "rider") return NextResponse.json({ error: "Rider sign-in required." }, { status: 403 });
  const { data, error } = await staffSupabase(auth.session.accessToken).from("rider_deliveries").select("order_id,order_number,customer_name,customer_phone,customer_address,status,created_at,items").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Assigned deliveries could not be loaded." }, { status: 503 });
  const response = NextResponse.json({ deliveries: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
}
