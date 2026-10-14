import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { staffSupabase, serverSupabase } from "@/lib/supabase";

function respond(response: NextResponse, auth: Awaited<ReturnType<typeof getAuthenticatedStaff>>) {
  return auth?.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || !["admin", "cashier"].includes(auth.session.role)) {
    return NextResponse.json({ error: "Staff sign-in required." }, { status: 401 });
  }

  try {
    const db = serverSupabase();
    const { data: tenant, error } = await db
      .from("tenants")
      .select("id,slug,brand_name,whatsapp_phone,primary_color,supplier_marketplace_phone,notify_low_stock_phone")
      .eq("id", auth.session.tenantId)
      .maybeSingle();

    if (error) throw error;
    if (!tenant) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });

    const settings = {
      tenant_id: tenant.id,
      slug: tenant.slug,
      brand_name: tenant.brand_name || "Restaurant",
      whatsapp_phone: tenant.whatsapp_phone || "923157244884",
      supplier_marketplace_phone: tenant.supplier_marketplace_phone || "923157244884",
      notify_low_stock_phone: tenant.notify_low_stock_phone || "923157244884",
      primary_color: tenant.primary_color || "#DC2626"
    };

    return respond(NextResponse.json({ settings }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load settings." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") {
    return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      brand_name?: string;
      whatsapp_phone?: string;
      supplier_marketplace_phone?: string;
      notify_low_stock_phone?: string;
      primary_color?: string;
    };

    const db = serverSupabase();
    const updates: Record<string, unknown> = {};

    if (body.brand_name !== undefined) updates.brand_name = body.brand_name.trim();
    if (body.whatsapp_phone !== undefined) updates.whatsapp_phone = body.whatsapp_phone.replace(/[\s-]/g, "");
    if (body.supplier_marketplace_phone !== undefined) updates.supplier_marketplace_phone = body.supplier_marketplace_phone.replace(/[\s-]/g, "");
    if (body.notify_low_stock_phone !== undefined) updates.notify_low_stock_phone = body.notify_low_stock_phone.replace(/[\s-]/g, "");
    if (body.primary_color !== undefined) updates.primary_color = body.primary_color.trim();

    // Try update with new columns; if columns aren't in Supabase yet, fallback to base columns
    let updateResult = await db.from("tenants").update(updates).eq("id", auth.session.tenantId).select().single();
    if (updateResult.error && updateResult.error.message.includes("column")) {
      delete updates.supplier_marketplace_phone;
      delete updates.notify_low_stock_phone;
      updateResult = await db.from("tenants").update(updates).eq("id", auth.session.tenantId).select().single();
    }

    if (updateResult.error) throw updateResult.error;

    return respond(NextResponse.json({ ok: true, settings: updateResult.data }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save settings." }, { status: 500 });
  }
}
