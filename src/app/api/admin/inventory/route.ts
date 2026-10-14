import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { staffSupabase } from "@/lib/supabase";

function respond(response: NextResponse, auth: Awaited<ReturnType<typeof getAuthenticatedStaff>>) {
  return auth?.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || !["admin", "cashier"].includes(auth.session.role)) {
    return NextResponse.json({ error: "Staff sign-in required." }, { status: 401 });
  }

  try {
    const db = staffSupabase(auth.session.accessToken);
    const [{ data: ingredients, error: ingError }, { data: vendors, error: venError }] = await Promise.all([
      db.from("ingredients").select("id,name,unit,current_stock,threshold").eq("tenant_id", auth.session.tenantId).order("name"),
      db.from("vendors").select("id,name,phone").eq("tenant_id", auth.session.tenantId).order("name")
    ]);

    if (ingError) throw ingError;
    if (venError) throw venError;

    return respond(
      NextResponse.json(
        {
          ingredients: ingredients ?? [],
          vendors: vendors ?? []
        },
        { headers: { "Cache-Control": "no-store" } }
      ),
      auth
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load inventory." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") {
    return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      action?: "save_ingredient" | "update_stock" | "delete_ingredient" | "save_vendor" | "vendor_alert";
      id?: string;
      name?: string;
      unit?: string;
      current_stock?: number;
      threshold?: number;
      vendor_id?: string;
      vendor_phone?: string;
      vendor_name?: string;
      order_quantity?: number;
    };

    const db = staffSupabase(auth.session.accessToken);

    // ── 1. UPDATE STOCK ONLY ──
    if (body.action === "update_stock") {
      if (!body.id || typeof body.current_stock !== "number") {
        return NextResponse.json({ error: "Ingredient ID and numeric stock value required." }, { status: 400 });
      }
      const { data, error } = await db
        .from("ingredients")
        .update({ current_stock: body.current_stock })
        .eq("id", body.id)
        .eq("tenant_id", auth.session.tenantId)
        .select("id,current_stock")
        .single();
      if (error) throw error;
      return respond(NextResponse.json({ ok: true, ingredient: data }), auth);
    }

    // ── 2. SAVE INGREDIENT (ADD / EDIT) ──
    if (body.action === "save_ingredient") {
      const name = body.name?.trim();
      const unit = body.unit?.trim() || "kg";
      const stock = Number(body.current_stock ?? 0);
      const threshold = Number(body.threshold ?? 5);

      if (!name) return NextResponse.json({ error: "Ingredient name is required." }, { status: 400 });

      const payload = {
        tenant_id: auth.session.tenantId,
        name,
        unit,
        current_stock: stock,
        threshold
      };

      let ingredientId = body.id;
      if (ingredientId) {
        const { data, error } = await db
          .from("ingredients")
          .update(payload)
          .eq("id", ingredientId)
          .eq("tenant_id", auth.session.tenantId)
          .select("id")
          .single();
        if (error) throw error;
        ingredientId = data.id;
      } else {
        const { data, error } = await db
          .from("ingredients")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        ingredientId = data.id;
      }

      return respond(NextResponse.json({ ok: true, id: ingredientId }), auth);
    }

    // ── 3. DELETE INGREDIENT ──
    if (body.action === "delete_ingredient") {
      if (!body.id) return NextResponse.json({ error: "Ingredient ID required." }, { status: 400 });
      await db.from("menu_item_ingredients").delete().eq("ingredient_id", body.id);
      await db.from("ingredient_vendors").delete().eq("ingredient_id", body.id);
      const { error } = await db.from("ingredients").delete().eq("id", body.id).eq("tenant_id", auth.session.tenantId);
      if (error) throw error;
      return respond(NextResponse.json({ ok: true }), auth);
    }

    // ── 4. SAVE VENDOR ──
    if (body.action === "save_vendor") {
      const vName = body.vendor_name?.trim();
      const vPhone = body.vendor_phone?.replace(/[\s-]/g, "") ?? "";
      if (!vName || !vPhone) return NextResponse.json({ error: "Vendor name and phone required." }, { status: 400 });

      const { data, error } = await db
        .from("vendors")
        .insert({ tenant_id: auth.session.tenantId, name: vName, phone: vPhone })
        .select("id,name,phone")
        .single();
      if (error) throw error;
      return respond(NextResponse.json({ ok: true, vendor: data }), auth);
    }

    // ── 5. GENERATE VENDOR WHATSAPP ALERT ──
    if (body.action === "vendor_alert") {
      const ingName = body.name?.trim() || "Ingredient";
      const unit = body.unit || "units";
      const neededQty = body.order_quantity || 10;
      let targetPhone = body.vendor_phone?.replace(/[\s-]/g, "") || "";

      // Format Pakistani number to international
      if (targetPhone.startsWith("03")) targetPhone = "92" + targetPhone.slice(1);
      if (!targetPhone) targetPhone = "923157244884"; // default vendor fallback

      const msg = `*PURCHASE ORDER — RESTAURANT INVENTORY*\n\nSalam, please arrange supply for:\n• Item: *${ingName}*\n• Quantity Needed: *${neededQty} ${unit}*\n• Stock Status: LOW STOCK ALERT\n\nPlease confirm availability and delivery time. Thank you!`;
      const waUrl = `https://wa.me/${encodeURIComponent(targetPhone)}?text=${encodeURIComponent(msg)}`;

      return respond(NextResponse.json({ ok: true, wa_url: waUrl }), auth);
    }

    return NextResponse.json({ error: "Unknown inventory action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inventory action failed." }, { status: 500 });
  }
}
