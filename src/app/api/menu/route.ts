import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  let tenantSlug = request.nextUrl.searchParams.get("tenant");
  if (!tenantSlug) tenantSlug = "demo"; // Default to primary tenant

  try {
    const db = serverSupabase();
    const { data: tenant, error: tenantError } = await db
      .from("tenants")
      .select("id,slug,brand_name,primary_color,whatsapp_phone,logo_url")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (tenantError) {
      return NextResponse.json({ error: "Tenant lookup failed in the connected database." }, { status: 503 });
    }
    if (!tenant) {
      return NextResponse.json({ error: `No restaurant found with slug '${tenantSlug}'.` }, { status: 404 });
    }

    const requestedTable = request.nextUrl.searchParams.get("table");
    let table: { id: string; table_number: string } | null = null;

    if (requestedTable) {
      const cleanReq = requestedTable.trim();
      const numOnly = cleanReq.replace(/\D/g, "");

      // Fetch all tables for this tenant
      const { data: allTables } = await db
        .from("restaurant_tables")
        .select("id,table_number")
        .eq("tenant_id", tenant.id);

      if (allTables && allTables.length > 0) {
        // Try exact match first
        table = allTables.find(
          (t) => t.table_number.toLowerCase() === cleanReq.toLowerCase()
        ) || null;

        // Try numeric normalized match (e.g. 1 -> T-01 or T-1)
        if (!table && numOnly) {
          const padded = `T-${numOnly.padStart(2, "0")}`;
          const unpadded = `T-${numOnly}`;
          table = allTables.find((t) => {
            const tNum = t.table_number.replace(/\D/g, "");
            return tNum === numOnly || t.table_number === padded || t.table_number === unpadded;
          }) || null;
        }
      }

      // If still not matched, construct virtual table record so user is never blocked
      if (!table) {
        const fallbackNumber = cleanReq.startsWith("T-") ? cleanReq : `T-${numOnly.padStart(2, "0") || cleanReq}`;
        table = { id: `table-${cleanReq}`, table_number: fallbackNumber };
      }
    }

    // Fetch categories and items
    const { data: categories, error: categoryError } = await db
      .from("menu_categories")
      .select("id,name,sort_order,menu_items(id,name,description,price,image_url,in_stock)")
      .eq("tenant_id", tenant.id)
      .order("sort_order");

    if (categoryError) throw categoryError;

    // Fetch special offers
    const { data: specialOffers } = await db
      .from("special_offers")
      .select("id,menu_item_id,card_style,badge_text,days_of_week,start_at,end_at,run_indefinitely")
      .eq("tenant_id", tenant.id);

    const fallbackCategories = [
      {
        id: "cat-main",
        name: "Main Course",
        sort_order: 0,
        menu_items: [
          {
            id: "item-biryani-1",
            name: "Special Chicken Biryani",
            description: "Traditional aromatic basmati rice cooked with succulent chicken, saffron, royal spices, and golden caramelized onions",
            price: 450,
            image_url: "/images/food/chicken-biryani.jpg",
            in_stock: true
          }
        ]
      },
      {
        id: "cat-burgers",
        name: "Burgers",
        sort_order: 1,
        menu_items: [
          {
            id: "item-burger-1",
            name: "Gourmet Beef Burger",
            description: "Juicy beef patty, melted cheddar, crisp lettuce, tomato & signature smokehouse sauce on toasted brioche",
            price: 850,
            image_url: "/images/food/beef-burger.jpg",
            in_stock: true
          }
        ]
      },
      {
        id: "cat-pizza",
        name: "Pizza",
        sort_order: 2,
        menu_items: [
          {
            id: "item-pizza-1",
            name: "Artisan Pepperoni Pizza",
            description: "Hand-tossed crust, rich San Marzano tomato sauce, fresh melted mozzarella and savory pepperoni slices",
            price: 1450,
            image_url: "/images/food/pepperoni-pizza.jpg",
            in_stock: true
          }
        ]
      },
      {
        id: "cat-pasta",
        name: "Pasta",
        sort_order: 3,
        menu_items: [
          {
            id: "item-pasta-1",
            name: "Creamy Fettuccine Alfredo",
            description: "Al dente pasta tossed in rich parmesan cream sauce with garlic and fresh Italian herbs",
            price: 1150,
            image_url: "/images/food/creamy-pasta.jpg",
            in_stock: true
          }
        ]
      },
      {
        id: "cat-coffee",
        name: "Coffee & Drinks",
        sort_order: 4,
        menu_items: [
          {
            id: "item-coffee-1",
            name: "Artisan Cappuccino",
            description: "Double espresso pulled fresh with velvety microfoam and rich aroma",
            price: 480,
            image_url: "/images/food/artisan-coffee.jpg",
            in_stock: true
          }
        ]
      }
    ];

    const finalCategories = (categories && categories.length > 0) ? categories : fallbackCategories;

    return NextResponse.json(
      {
        tenant,
        table,
        categories: finalCategories,
        special_offers: specialOffers ?? []
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load menu." },
      { status: 503 }
    );
  }
}
