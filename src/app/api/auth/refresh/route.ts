import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
  const response = NextResponse.json({ ok: true, expires_at: auth.session.expiresAt });
  return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
}
