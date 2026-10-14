import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { serverSupabase } from "@/lib/supabase";

const SEEDED_PRODUCTS = [
  {
    id: "sp-1",
    category: "Kitchen Equipment",
    name: "Commercial Double Deep Fryer (12L)",
    description: "Stainless steel dual basket heavy-duty temperature-controlled electric fryer.",
    image_url: "https://images.unsplash.com/photo-1590794056226-79ef3a8147e1?auto=format&fit=crop&w=600&q=80",
    price: 48500,
    active: true
  },
  {
    id: "sp-2",
    category: "Kitchen Equipment",
    name: "Heavy Duty Flat Top Griddle (Gas)",
    description: "36-inch cast-iron flat top grill for smash burgers, steaks, and wraps.",
    image_url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=600&q=80",
    price: 65000,
    active: true
  },
  {
    id: "sp-3",
    category: "Disposables & Packaging",
    name: "Eco Kraft Burger Boxes (Pack of 500)",
    description: "Greaseproof biodegradable premium kraft takeaway clamshell boxes.",
    image_url: "https://images.unsplash.com/photo-1530587191325-3db32d826c18?auto=format&fit=crop&w=600&q=80",
    price: 4200,
    active: true
  },
  {
    id: "sp-4",
    category: "Disposables & Packaging",
    name: "Custom Branded 2-Ply Tissues (Box of 1000)",
    description: "Embossed restaurant-grade soft absorbent paper napkins with dispenser fit.",
    image_url: "https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=600&q=80",
    price: 1850,
    active: true
  },
  {
    id: "sp-5",
    category: "Kitchen Supplies",
    name: "Thermal POS Receipt Paper Rolls 80mm (Box of 50)",
    description: "BPA-free high sensitivity dark print thermal roll for kitchen & counter printers.",
    image_url: "https://images.unsplash.com/photo-1607344645866-009c320c5ab8?auto=format&fit=crop&w=600&q=80",
    price: 6500,
    active: true
  },
  {
    id: "sp-6",
    category: "Kitchen Supplies",
    name: "Chef Sanitation Apron & Nitrile Gloves (Pack of 100)",
    description: "Food-safe powder-free black nitrile gloves and waterproof kitchen apron.",
    image_url: "https://images.unsplash.com/photo-1584634731339-252c581abfc5?auto=format&fit=crop&w=600&q=80",
    price: 2300,
    active: true
  },
  {
    id: "sp-7",
    category: "Beverage Supplies",
    name: "Cold Drink PET Cups with Domes 500ml (300 pcs)",
    description: "Clear crystal plastic cups for milkshakes, mocktails, iced coffee, and sodas.",
    image_url: "https://images.unsplash.com/photo-1517256064527-09c73fc73e38?auto=format&fit=crop&w=600&q=80",
    price: 3600,
    active: true
  },
  {
    id: "sp-8",
    category: "Kitchen Equipment",
    name: "Digital Kitchen Weighing Scale (30kg)",
    description: "Precision high-accuracy stainless steel platform scale for ingredient prep.",
    image_url: "https://images.unsplash.com/photo-1516594798947-e65505dbb29d?auto=format&fit=crop&w=600&q=80",
    price: null, // Contact for price
    active: true
  }
];

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
    // Try fetch from supply_products table if exists, else use seeded list
    let products = SEEDED_PRODUCTS;
    const { data: dbProducts, error } = await db.from("supply_products").select("*").eq("active", true);
    if (!error && dbProducts && dbProducts.length > 0) {
      products = dbProducts;
    }

    // Get supplier phone from tenant
    const { data: tenant } = await db
      .from("tenants")
      .select("supplier_marketplace_phone,brand_name")
      .eq("id", auth.session.tenantId)
      .maybeSingle();

    const supplierPhone = tenant?.supplier_marketplace_phone || "923157244884";

    return respond(
      NextResponse.json({
        products,
        supplier_phone: supplierPhone,
        restaurant_name: tenant?.brand_name || "Restaurant"
      }),
      auth
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load supplier products." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") {
    return NextResponse.json({ error: "Manager/admin sign-in required." }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      items: { product_id: string; name: string; quantity: number; price?: number | null }[];
      notes?: string;
    };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "No items selected." }, { status: 400 });
    }

    const db = serverSupabase();
    const { data: tenant } = await db
      .from("tenants")
      .select("brand_name,supplier_marketplace_phone,slug")
      .eq("id", auth.session.tenantId)
      .maybeSingle();

    const restaurantName = tenant?.brand_name || auth.session.tenantSlug.toUpperCase();
    let supplierPhone = tenant?.supplier_marketplace_phone || "923157244884";
    if (supplierPhone.startsWith("03")) supplierPhone = "92" + supplierPhone.slice(1);

    const totalAmount = body.items.reduce((sum, it) => sum + (it.price ? it.price * it.quantity : 0), 0);

    // Try save to stock_orders table if exists
    let stockOrderId = `so-${Date.now()}`;
    try {
      const { data: savedOrder } = await db
        .from("stock_orders")
        .insert({
          tenant_id: auth.session.tenantId,
          items: body.items,
          total_amount: totalAmount || null,
          status: "PENDING"
        })
        .select("id")
        .maybeSingle();
      if (savedOrder) stockOrderId = savedOrder.id;
    } catch {
      // Table may not be migrated yet
    }

    // Build free wa.me WhatsApp link
    const itemLines = body.items
      .map((it) => `• ${it.quantity}x *${it.name}* ${it.price ? `(Rs. ${(it.price * it.quantity).toLocaleString()})` : "(Price on Inquiry)"}`)
      .join("\n");

    const messageText = `*OFFICIAL STOCK PURCHASE ORDER*\n` +
      `Restaurant: *${restaurantName}*\n` +
      `Order Ref: #${stockOrderId.slice(-6).toUpperCase()}\n\n` +
      `*Requested Supplies & Equipment:*\n${itemLines}\n\n` +
      (totalAmount > 0 ? `*Estimated Total: Rs. ${totalAmount.toLocaleString()}*\n\n` : "") +
      `Please confirm quote, availability, and delivery dispatch schedule. Thank you!`;

    const waUrl = `https://wa.me/${encodeURIComponent(supplierPhone)}?text=${encodeURIComponent(messageText)}`;

    return respond(NextResponse.json({ ok: true, order_id: stockOrderId, wa_url: waUrl }), auth);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit stock order." }, { status: 500 });
  }
}
