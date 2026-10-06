import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { publicSupabase, staffSupabase } from "@/lib/supabase";

export type StaffRole = "admin" | "cashier" | "kitchen" | "rider";
export type StaffSession = {
  userId: string;
  authUserId: string;
  tenantId: string;
  tenantSlug: string;
  name: string;
  role: StaffRole;
  expiresAt: number;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
};
const SESSION_COOKIE = "rms_staff_session";
const SESSION_HOURS = 10;

function secret() {
  const value = process.env.STAFF_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("Set STAFF_SESSION_SECRET to a random secret of at least 32 characters.");
  return value;
}
function encryptionKey() { return createHash("sha256").update("rms-staff-session-encryption-v1:").update(secret()).digest(); }

export function verifyCredential(encoded: string | null, supplied: string) {
  if (!encoded || supplied.length > 128) return false;
  const [algorithm, salt, expected, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || extra !== undefined || !/^[a-f\d]{128}$/i.test(expected ?? "")) return false;
  try {
    const actual = scryptSync(supplied, salt, 64); const target = Buffer.from(expected, "hex");
    return target.length === actual.length && timingSafeEqual(actual, target);
  } catch { return false; }
}

export function deriveAuthPassword(userId: string) {
  return createHmac("sha256", secret()).update(`supabase-staff-bridge-v1:${userId}`).digest("base64url");
}

export function supabaseClaims(accessToken: string): Record<string, unknown> | null {
  try {
    const pieces = accessToken.split(".");
    if (pieces.length !== 3) return null;
    return JSON.parse(Buffer.from(pieces[1], "base64url").toString()) as Record<string, unknown>;
  } catch { return null; }
}

export function hasExpectedAuthClaims(session: Pick<StaffSession, "authUserId" | "userId" | "tenantId" | "role">, accessToken: string) {
  const claims = supabaseClaims(accessToken);
  return claims?.sub === session.authUserId && claims?.staff_user_id === session.userId && claims?.tenant_id === session.tenantId && claims?.staff_role === session.role && Number(claims?.exp) * 1000 > Date.now();
}

export function createSession(data: Omit<StaffSession, "expiresAt"> & { expiresAt?: number }) {
  const payload = Buffer.from(JSON.stringify({ ...data, expiresAt: data.expiresAt ?? Date.now() + SESSION_HOURS * 60 * 60 * 1000 }));
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return `${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function readSession(token?: string | null): StaffSession | null {
  if (!token) return null;
  const [ivValue, encryptedValue, tagValue, extra] = token.split(".");
  if (!ivValue || !encryptedValue || !tagValue || extra) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString()) as StaffSession;
    if (!data.userId || !data.authUserId || !data.tenantId || !data.tenantSlug || !data.name || !["admin", "cashier", "kitchen", "rider"].includes(data.role) || !data.accessToken || !data.refreshToken || data.expiresAt <= Date.now()) return null;
    return data;
  } catch { return null; }
}

export async function getAuthenticatedStaff(request: NextRequest): Promise<{ session: StaffSession; renewedCookie?: string } | null> {
  let session = readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return getBearerStaff(request);
    if (session.accessExpiresAt > Date.now() + 60_000 && hasExpectedAuthClaims(session, session.accessToken)) return { session };
  try {
    const { data, error } = await publicSupabase().auth.refreshSession({ refresh_token: session.refreshToken });
    if (error || !data.session) return null;
    session = { ...session, accessToken: data.session.access_token, refreshToken: data.session.refresh_token, accessExpiresAt: (data.session.expires_at ?? Math.floor(Date.now() / 1000 + data.session.expires_in)) * 1000 };
    if (!hasExpectedAuthClaims(session, session.accessToken)) return null;
    return { session, renewedCookie: createSession(session) };
  } catch { return null; }
}

async function getBearerStaff(request: NextRequest): Promise<{ session: StaffSession } | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return null;
  const accessToken = match[1];
  try {
    const { data, error } = await publicSupabase().auth.getUser(accessToken);
    if (error || !data.user) return null;
    const claims = supabaseClaims(accessToken);
    const appMetadata = data.user.app_metadata as Record<string, unknown>;
    const userId = typeof claims?.staff_user_id === "string" ? claims.staff_user_id : "";
    const tenantId = typeof claims?.tenant_id === "string" ? claims.tenant_id : "";
    const role = claims?.staff_role;
    if (!userId || !tenantId || !["admin", "cashier", "kitchen", "rider"].includes(String(role))
      || appMetadata.staff_user_id !== userId || appMetadata.tenant_id !== tenantId || appMetadata.staff_role !== role) return null;

    const db = staffSupabase(accessToken);
    const [{ data: staff, error: staffError }, { data: tenant, error: tenantError }] = await Promise.all([
      db.from("users").select("id,tenant_id,name,role,active,auth_user_id").eq("id", userId).eq("tenant_id", tenantId).maybeSingle(),
      db.from("tenants").select("id,slug").eq("id", tenantId).maybeSingle(),
    ]);
    if (staffError || tenantError || !staff?.active || staff.auth_user_id !== data.user.id || staff.role !== role || !tenant) return null;
    const expiresAt = Number(claims?.exp) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return { session: {
      userId, authUserId: data.user.id, tenantId, tenantSlug: tenant.slug, name: staff.name, role: role as StaffRole,
      expiresAt, accessToken, refreshToken: "", accessExpiresAt: expiresAt,
    } };
  } catch { return null; }
}

export function applyStaffCookie(response: NextResponse, value: string, expiresAt: number) {
  response.cookies.set(SESSION_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) });
  return response;
}

export function clearStaffCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

export const sessionCookieName = SESSION_COOKIE;
