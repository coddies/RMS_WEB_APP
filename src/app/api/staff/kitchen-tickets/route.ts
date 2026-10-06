import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { staffSupabase } from "@/lib/supabase";
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "kitchen") return NextResponse.json({ error: "Kitchen sign-in required." }, { status: 403 });
  const { data, error } = await staffSupabase(auth.session.accessToken).from("kitchen_tickets").select("order_id,order_number,table_id,table_number,status,created_at,items").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Kitchen tickets could not be loaded." }, { status: 503 });
  const response = NextResponse.json({ tickets: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "kitchen") return NextResponse.json({ error: "Kitchen sign-in required." }, { status: 403 });
  try {
    const body = await request.json() as { order_id?: string; status?: string };
    if (!body.order_id || !["PREPARING", "READY"].includes(body.status ?? "")) {
      return NextResponse.json({ error: "Provide an order id and valid kitchen status." }, { status: 400 });
    }
    const { data, error } = await staffSupabase(auth.session.accessToken).from("orders")
      .update({ status: body.status }).eq("tenant_id", auth.session.tenantId).eq("id", body.order_id)
      .in("status", body.status === "PREPARING" ? ["PENDING"] : ["PREPARING"])
      .select("id,status").maybeSingle();
    if (error) return NextResponse.json({ error: "Kitchen ticket could not be updated." }, { status: 503 });
    if (!data) return NextResponse.json({ error: "Order is no longer available for that status change." }, { status: 409 });
    const response = NextResponse.json({ order_id: data.id, status: data.status });
    return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kitchen ticket could not be updated." }, { status: 400 });
  }
}
