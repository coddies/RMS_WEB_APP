import { NextRequest, NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase";
export async function GET(request: NextRequest) {
  const tenantSlug = request.nextUrl.searchParams.get("tenant");
  if (!tenantSlug) return NextResponse.json({ error: "Tenant is required." }, { status: 400 });
  try {
    const db = serverSupabase();
    const { data: tenant, error: tenantError } = await db.from("tenants").select("id,slug,brand_name,primary_color,whatsapp_phone").eq("slug", tenantSlug).maybeSingle();
    if (tenantError) return NextResponse.json({ error: "Tenant lookup failed in the connected Supabase project. Check the tenants schema and project URL." }, { status: 503 });
    if (!tenant) return NextResponse.json({ error: `No tenant row has slug '${tenantSlug}'.` }, { status: 404 });
    const tableNumber = request.nextUrl.searchParams.get("table");
    let table: { id: string; table_number: string } | null = null;
    if (tableNumber) {
      const { data, error: tableError } = await db.from("restaurant_tables").select("id,table_number").eq("tenant_id", tenant.id).eq("table_number", tableNumber).single();
      if (tableError || !data) return NextResponse.json({ error: "Table not found." }, { status: 404 });
      table = data;
    }
    const { data: categories, error: categoryError } = await db.from("menu_categories").select("id,name,sort_order,menu_items(id,name,description,price,image_url,in_stock)").eq("tenant_id", tenant.id).order("sort_order");
    if (categoryError) throw categoryError;
    return NextResponse.json({ tenant, table, categories: categories ?? [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load menu." }, { status: 503 }); }
}
