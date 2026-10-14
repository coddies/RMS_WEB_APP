import { NextRequest, NextResponse } from "next/server";
import { clearStaffCookie, readSession, sessionCookieName } from "@/lib/staff-auth";
import { publicSupabase } from "@/lib/supabase";
export async function POST(request: NextRequest) {
  const session = readSession(request.cookies.get(sessionCookieName)?.value);
  if (session) {
    try {
      const auth = publicSupabase();
      await auth.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken });
      await auth.auth.signOut({ scope: "local" });
    } catch { /* Clearing the browser session still signs this device out. */ }
  }
  return clearStaffCookie(NextResponse.redirect(new URL("/login", request.url), 303));
}
