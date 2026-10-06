import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { staffSupabase } from "@/lib/supabase";

type SubmittedItem = { item_id: string; quantity: number };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { tenant_slug?: string; table_number?: string; order_type?: string; customer_name?: string; customer_phone?: string; customer_address?: string; website?: string; items?: SubmittedItem[] };
    if (typeof body.website === "string" && body.website.trim()) return NextResponse.json({ ignored: true }, { status: 202 });
    if (!body.tenant_slug || !Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: "Restaurant and at least one item are required." }, { status: 400 });
    if (body.items.some((item) => !item.item_id || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      return NextResponse.json({ error: "Each item must have a valid quantity." }, { status: 400 });
    }

    const db = serverSupabase();
    if (body.order_type === "DELIVERY" || !body.table_number) {
      const name = body.customer_name?.trim() ?? "";
      const phone = body.customer_phone?.replace(/[\s-]/g, "") ?? "";
      const address = body.customer_address?.trim() ?? "";
      if (name.length < 2 || name.length > 120) return NextResponse.json({ error: "Enter a name with at least 2 characters." }, { status: 400 });
      if (!/^03\d{9}$/.test(phone)) return NextResponse.json({ error: "Enter a Pakistani mobile number in 03XXXXXXXXX format." }, { status: 400 });
      if (address.length < 10 || address.length > 500) return NextResponse.json({ error: "Enter a delivery address with at least 10 characters." }, { status: 400 });
      if (body.items.length > 50 || body.items.some((item) => item.quantity > 99)) return NextResponse.json({ error: "Check your cart quantities and try again." }, { status: 400 });
      const { data, error } = await db.rpc("rms_submit_delivery_order", {
        p_tenant_slug: body.tenant_slug,
        p_customer_name: name,
        p_customer_phone: phone,
        p_customer_address: address,
        p_items: body.items,
      });
      if (error) {
        if (error.message.includes("DELIVERY_RATE_LIMIT")) return NextResponse.json({ error: "This phone number has reached the limit of 5 orders per hour. Please try again later." }, { status: 429 });
        if (error.message.includes("TENANT_NOT_FOUND")) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });
        if (error.message.includes("INVALID_OR_UNAVAILABLE_MENU_ITEM")) return NextResponse.json({ error: "One or more selected items are sold out or unavailable." }, { status: 409 });
        throw error;
      }
      const order = Array.isArray(data) ? data[0] : data;
      if (!order) throw new Error("The delivery order was not saved.");
      return NextResponse.json({ id: order.order_id, order_number: order.order_number, total_amount: order.total_amount, items: order.items }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const { data: tenant, error: tenantError } = await db.from("tenants").select("id").eq("slug", body.tenant_slug).single();
    if (tenantError || !tenant) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });
    const { data: table, error: tableError } = await db.from("restaurant_tables").select("id").eq("tenant_id", tenant.id).eq("table_number", body.table_number).single();
    if (tableError || !table) return NextResponse.json({ error: "Table not found for this restaurant." }, { status: 404 });

    const ids = [...new Set(body.items.map((item) => item.item_id))];
    const { data: available, error: itemsError } = await db.from("menu_items").select("id,name,price,in_stock").eq("tenant_id", tenant.id).in("id", ids);
    if (itemsError) throw itemsError;
    if (!available || available.length !== ids.length || available.some((item) => !item.in_stock)) {
      return NextResponse.json({ error: "One or more selected items are sold out or unavailable." }, { status: 409 });
    }

    const itemMap = new Map(available.map((item) => [item.id, item]));
    const orderItems = body.items.map((item) => {
      const menuItem = itemMap.get(item.item_id)!;
      return { menu_item_id: menuItem.id, quantity: item.quantity, price_at_order: menuItem.price };
    });
    const totalAmount = orderItems.reduce((total, item) => total + Number(item.price_at_order) * item.quantity, 0);
    const { data: order, error: orderError } = await db.from("orders").insert({
      tenant_id: tenant.id,
      table_id: table.id,
      order_type: "DINE_IN",
      status: "PENDING",
      total_amount: totalAmount,
      sync_status: "SYNCED",
    }).select("id,order_number").single();
    if (orderError) throw orderError;

    const { error: orderItemsError } = await db.from("order_items").insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
    if (orderItemsError) {
      await db.from("orders").delete().eq("id", order.id);
      throw orderItemsError;
    }
    return NextResponse.json({ id: order.id, order_number: order.order_number }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit order." }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || !["admin", "cashier"].includes(auth.session.role)) return NextResponse.json({ error: "Sign in with a cashier or manager account." }, { status: 401 });
  try {
    const db = staffSupabase(auth.session.accessToken);
    const { data: tenant, error: tenantError } = await db.from("tenants").select("id,slug").eq("id", auth.session.tenantId).eq("slug", auth.session.tenantSlug).single();
    if (tenantError || !tenant) return NextResponse.json({ error: "Restaurant not found." }, { status: 404 });
    const { data: tables, error: tableError } = await db.from("restaurant_tables").select("id,table_number").eq("tenant_id", tenant.id);
    if (tableError) throw tableError;
    const { data: orders, error: orderError } = await db.from("orders")
      .select("id,order_number,table_id,order_type,customer_name,customer_phone,customer_address,created_at,order_items(quantity,price_at_order,menu_items(name))")
      .eq("tenant_id", tenant.id).eq("status", "PENDING")
      .order("created_at", { ascending: false });
    if (orderError) throw orderError;
    const normalizedOrders = (orders ?? []).map((order) => ({
      ...order,
      items: (order.order_items ?? []).map((item: { quantity: number; menu_items: { name: string } | { name: string }[] | null }) => ({
        name: (Array.isArray(item.menu_items) ? item.menu_items[0]?.name : item.menu_items?.name) ?? "Menu item",
        quantity: item.quantity,
      })),
    }));
    const response = NextResponse.json({ tenant_id: tenant.id, tables: tables ?? [], orders: normalizedOrders }, { headers: { "Cache-Control": "no-store" } });
    return auth.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load orders." }, { status: 503 });
  }
}
