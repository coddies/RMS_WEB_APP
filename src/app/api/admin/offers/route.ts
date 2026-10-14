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
    const { data: offers, error } = await db
      .from("special_offers")
      .select("id,menu_item_id,card_style,badge_text,days_of_week,start_at,end_at,run_indefinitely,menu_items(id,name,price,image_url,description,in_stock)")
      .eq("tenant_id", auth.session.tenantId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const normalized = (offers ?? []).map((o) => {
      const item = Array.isArray(o.menu_items) ? o.menu_items[0] : o.menu_items;
      return {
        id: o.id,
        menu_item_id: o.menu_item_id,
        card_style: o.card_style,
        badge_text: o.badge_text,
        days_of_week: o.days_of_week || [],
        start_at: o.start_at,
        end_at: o.end_at,
        run_indefinitely: Boolean(o.run_indefinitely),
        item: item ? {
          id: item.id,
          name: item.name,
          price: item.price,
          image_url: item.image_url,
          description: item.description,
          in_stock: item.in_stock
        } : null
      };
    });

    return respond(NextResponse.json({ offers: normalized }, { headers: { "Cache-Control": "no-store" } }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load special offers." }, { status: 503 });
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
      menu_item_id?: string;
      card_style?: "flame" | "gradient" | "ribbon" | "countdown" | "seasonal_frame";
      badge_text?: string;
      days_of_week?: string[];
      start_at?: string | null;
      end_at?: string | null;
      run_indefinitely?: boolean;
    };

    if (!body.menu_item_id) {
      return NextResponse.json({ error: "Select a menu item for the special offer." }, { status: 400 });
    }

    const cardStyle = body.card_style || "flame";
    const allowedStyles = ["flame", "gradient", "ribbon", "countdown", "seasonal_frame"];
    if (!allowedStyles.includes(cardStyle)) {
      return NextResponse.json({ error: "Invalid card style." }, { status: 400 });
    }

    const days = Array.isArray(body.days_of_week) && body.days_of_week.length > 0
      ? body.days_of_week.map((d) => String(d).toLowerCase().slice(0, 3))
      : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    const db = staffSupabase(auth.session.accessToken);

    // Verify menu item belongs to tenant
    const { data: item, error: itemError } = await db
      .from("menu_items")
      .select("id,name,price")
      .eq("id", body.menu_item_id)
      .eq("tenant_id", auth.session.tenantId)
      .maybeSingle();

    if (itemError || !item) {
      return NextResponse.json({ error: "Menu item not found in this restaurant." }, { status: 404 });
    }

    const payload = {
      tenant_id: auth.session.tenantId,
      menu_item_id: body.menu_item_id,
      card_style: cardStyle,
      badge_text: body.badge_text?.trim() || null,
      days_of_week: days,
      start_at: body.start_at || null,
      end_at: body.end_at || null,
      run_indefinitely: body.run_indefinitely ?? true
    };

    let offerId = body.id;
    if (offerId) {
      const { data, error } = await db
        .from("special_offers")
        .update(payload)
        .eq("id", offerId)
        .eq("tenant_id", auth.session.tenantId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      offerId = data?.id;
    } else {
      const { data, error } = await db
        .from("special_offers")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      offerId = data.id;
    }

    return respond(NextResponse.json({ ok: true, id: offerId }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save special offer." }, { status: 500 });
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
    if (!id) return NextResponse.json({ error: "Offer ID is required." }, { status: 400 });

    const db = staffSupabase(auth.session.accessToken);
    const { error } = await db
      .from("special_offers")
      .delete()
      .eq("id", id)
      .eq("tenant_id", auth.session.tenantId);

    if (error) throw error;
    return respond(NextResponse.json({ ok: true }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete special offer." }, { status: 500 });
  }
}
