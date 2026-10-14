import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { serverSupabase } from "@/lib/supabase";
import { randomBytes, scryptSync } from "node:crypto";

function respond(response: NextResponse, auth: Awaited<ReturnType<typeof getAuthenticatedStaff>>) {
  return auth?.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
}

function hashPassword(pass: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pass, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") {
    return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  }

  try {
    const db = serverSupabase();
    const { data: staff, error } = await db
      .from("users")
      .select("id,name,username,phone,role,active")
      .eq("tenant_id", auth.session.tenantId)
      .order("name");

    if (error) throw error;
    return respond(NextResponse.json({ staff: staff ?? [] }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load staff list." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") {
    return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      id?: string;
      name?: string;
      username?: string;
      phone?: string;
      role?: "admin" | "cashier" | "kitchen" | "rider";
      pin?: string;
      password?: string;
      active?: boolean;
    };

    const name = body.name?.trim();
    const role = body.role || "cashier";
    const username = body.username?.trim();
    const phone = body.phone?.replace(/[\s-]/g, "") || null;
    const cred = body.pin?.trim() || body.password?.trim();

    if (!name || (!username && role !== "rider")) {
      return NextResponse.json({ error: "Staff name and username are required." }, { status: 400 });
    }

    const db = serverSupabase();
    const payload: Record<string, unknown> = {
      tenant_id: auth.session.tenantId,
      name,
      role,
      username: username || null,
      phone: phone || null,
      active: body.active !== undefined ? body.active : true
    };

    if (cred) {
      const hash = hashPassword(cred);
      if (role === "admin") {
        payload.password_hash = hash;
      } else {
        payload.pin_hash = hash;
      }
    }

    let staffId = body.id;
    if (staffId) {
      const { data, error } = await db
        .from("users")
        .update(payload)
        .eq("id", staffId)
        .eq("tenant_id", auth.session.tenantId)
        .select("id")
        .single();
      if (error) throw error;
      staffId = data.id;
    } else {
      if (!cred) {
        return NextResponse.json({ error: "A PIN or password is required for new staff." }, { status: 400 });
      }
      const { data, error } = await db
        .from("users")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      staffId = data.id;
    }

    return respond(NextResponse.json({ ok: true, id: staffId }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save staff account." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") {
    return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Staff ID required." }, { status: 400 });

    const db = serverSupabase();
    // Soft-deactivate to avoid breaking historical foreign keys
    const { error } = await db
      .from("users")
      .update({ active: false })
      .eq("id", id)
      .eq("tenant_id", auth.session.tenantId);

    if (error) throw error;
    return respond(NextResponse.json({ ok: true }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to deactivate staff." }, { status: 500 });
  }
}
