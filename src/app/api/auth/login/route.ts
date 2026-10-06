import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, createSession, deriveAuthPassword, hasExpectedAuthClaims, verifyCredential, type StaffRole } from "@/lib/staff-auth";
import { publicSupabase, serverSupabase } from "@/lib/supabase";

const allowedRoles: StaffRole[] = ["admin", "cashier", "kitchen", "rider"];
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { tenant?: string; role?: StaffRole; identity?: string; credential?: string; native_counter?: boolean };
    if (!body.tenant || !body.role || !allowedRoles.includes(body.role) || !body.identity?.trim() || !body.credential) {
      return NextResponse.json({ error: "Enter restaurant, role, and login details." }, { status: 400 });
    }
    if (body.native_counter && !["cashier", "kitchen"].includes(body.role)) {
      return NextResponse.json({ error: "The native counter app accepts Cashier or Kitchen staff only." }, { status: 403 });
    }
    if (body.credential.length > 128 || body.identity.length > 160) return NextResponse.json({ error: "Invalid login." }, { status: 400 });
    const db = serverSupabase();
    const { data: tenant } = await db.from("tenants").select("id,slug").eq("slug", body.tenant.trim()).single();
    if (!tenant) return NextResponse.json({ error: "Invalid restaurant or login details." }, { status: 401 });
    const field = body.role === "rider" ? "phone" : "username";
    const credentialField = body.role === "admin" ? "password_hash" : "pin_hash";
    const { data: user, error: userError } = await db.from("users").select(`id,name,role,active,${credentialField},tenant_id,auth_user_id`).eq(field, body.identity.trim()).eq("tenant_id", tenant.id).eq("role", body.role).eq("active", true).maybeSingle();
    if (userError) throw new Error("Roles & Auth database migration is required before staff can sign in.");
    const hash = (user as Record<string, unknown> | null)?.[credentialField] as string | null | undefined;
    if (!user || !verifyCredential(hash ?? null, body.credential)) return NextResponse.json({ error: "Invalid restaurant or login details." }, { status: 401 });
    const email = `staff-${user.id}@auth.rms.invalid`; const password = deriveAuthPassword(user.id); const appMetadata = { tenant_id: tenant.id, staff_user_id: user.id, staff_role: body.role };
    let authUserId = user.auth_user_id as string | null;
    if (authUserId) {
      const { error } = await db.auth.admin.updateUserById(authUserId, { email, password, email_confirm: true, app_metadata: appMetadata });
      if (error) throw new Error("Supabase Auth staff identity could not be synchronized.");
    } else {
      const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: appMetadata });
      if (error || !created.user) throw new Error("Supabase Auth could not provision this staff identity.");
      authUserId = created.user.id;
      const { error: linkError } = await db.from("users").update({ auth_user_id: authUserId }).eq("id", user.id).eq("tenant_id", tenant.id);
      if (linkError) {
        await db.auth.admin.deleteUser(authUserId);
        throw new Error("Staff Auth mapping could not be saved. Apply the Roles & Auth migration and retry.");
      }
    }
    const { data: signedIn, error: signInError } = await publicSupabase().auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session || !authUserId) throw new Error("Supabase Auth sign-in failed. Check password sign-in settings.");
    const accessToken = signedIn.session.access_token;
    if (!hasExpectedAuthClaims({ authUserId, userId: user.id, tenantId: tenant.id, role: body.role }, accessToken)) {
      return NextResponse.json({ error: "Enable the Supabase Custom Access Token hook from the Roles & Auth migration before staff sign-in." }, { status: 503 });
    }
    const expiresAt = Date.now() + 10 * 60 * 60 * 1000;
    const token = createSession({ userId: user.id, authUserId, tenantId: tenant.id, tenantSlug: tenant.slug, name: user.name, role: body.role, accessToken, refreshToken: signedIn.session.refresh_token, accessExpiresAt: (signedIn.session.expires_at ?? Math.floor(Date.now() / 1000 + signedIn.session.expires_in)) * 1000, expiresAt });
    const responseBody = body.native_counter
      ? { role: body.role, name: user.name, tenant_id: tenant.id, tenant_slug: tenant.slug, user_id: user.id, access_token: accessToken, refresh_token: signedIn.session.refresh_token, expires_at: (signedIn.session.expires_at ?? Math.floor(Date.now() / 1000 + signedIn.session.expires_in)) * 1000 }
      : { role: body.role, name: user.name, destination: body.role === "cashier" ? "/cashier" : "/staff" };
    return applyStaffCookie(NextResponse.json(responseBody), token, expiresAt);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to sign in." }, { status: 503 });
  }
}
