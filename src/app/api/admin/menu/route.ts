import { NextRequest, NextResponse } from "next/server";
import { applyStaffCookie, getAuthenticatedStaff } from "@/lib/staff-auth";
import { staffSupabase } from "@/lib/supabase";

type IngredientLink = { ingredient_id: string; quantity_required: number };
function respond(response: NextResponse, auth: Awaited<ReturnType<typeof getAuthenticatedStaff>>) { return auth?.renewedCookie ? applyStaffCookie(response, auth.renewedCookie, auth.session.expiresAt) : response; }
function fail(message: string, status = 400, auth?: Awaited<ReturnType<typeof getAuthenticatedStaff>>) { return respond(NextResponse.json({ error: message }, { status }), auth ?? null); }
function isCloudinaryUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && url.pathname.includes("/image/upload/"); }
  catch { return false; }
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") return fail("Manager/admin sign-in required.", 401);
  try {
    const db = staffSupabase(auth.session.accessToken);
    const [{ data: categories, error: categoriesError }, { data: ingredients, error: ingredientsError }] = await Promise.all([
      db.from("menu_categories").select("id,name,sort_order,menu_items(id,name,price,category_id,image_url,description,in_stock)").eq("tenant_id", auth.session.tenantId).order("sort_order"),
      db.from("ingredients").select("id,name,unit").eq("tenant_id", auth.session.tenantId).order("name"),
    ]);
    if (categoriesError) throw categoriesError;
    if (ingredientsError) throw ingredientsError;
    const itemIds = (categories ?? []).flatMap((category) => (category.menu_items ?? []).map((item: { id: string }) => item.id));
    const { data: links, error: linksError } = itemIds.length ? await db.from("menu_item_ingredients").select("menu_item_id,ingredient_id,quantity_required").in("menu_item_id", itemIds) : { data: [], error: null };
    if (linksError) throw linksError;
    return respond(NextResponse.json({ categories: categories ?? [], ingredients: ingredients ?? [], links: links ?? [] }, { headers: { "Cache-Control": "no-store" } }), auth);
  } catch (error) { return fail(error instanceof Error ? error.message : "Could not load menu management.", 503, auth); }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedStaff(request);
  if (!auth || auth.session.role !== "admin") return fail("Manager/admin sign-in required.", 401);
  try {
    const body = await request.json() as { action?: string; id?: string; name?: string; price?: number; category_id?: string; description?: string; image_url?: string | null; in_stock?: boolean; ingredients?: IngredientLink[] };
    const db = staffSupabase(auth.session.accessToken);
    if (body.action === "stock") {
      if (!body.id || typeof body.in_stock !== "boolean") return fail("Item and stock status are required.", 400, auth);
      const { data, error } = await db.from("menu_items").update({ in_stock: body.in_stock }).eq("id", body.id).eq("tenant_id", auth.session.tenantId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return fail("Menu item not found.", 404, auth);
      return respond(NextResponse.json({ ok: true }), auth);
    }
    if (body.action === "delete") {
      if (!body.id) return fail("Menu item is required.", 400, auth);
      const { data: item, error: itemError } = await db.from("menu_items").select("id").eq("id", body.id).eq("tenant_id", auth.session.tenantId).maybeSingle();
      if (itemError) throw itemError;
      if (!item) return fail("Menu item not found.", 404, auth);
      const { data: orderReference, error: orderError } = await db.from("order_items").select("id").eq("menu_item_id", body.id).limit(1);
      if (orderError) throw orderError;
      if (orderReference?.length) return fail("This item is part of order history. Mark it sold out instead of deleting it.", 409, auth);
      const { error: linksError } = await db.from("menu_item_ingredients").delete().eq("menu_item_id", body.id);
      if (linksError) throw linksError;
      const { error } = await db.from("menu_items").delete().eq("id", body.id).eq("tenant_id", auth.session.tenantId);
      if (error) throw error;
      return respond(NextResponse.json({ ok: true }), auth);
    }
    if (body.action !== "save") return fail("Unknown menu action.", 400, auth);
    const name = body.name?.trim(); const price = Number(body.price); const description = body.description?.trim() ?? ""; const imageUrl = body.image_url?.trim() || null;
    if (!name || name.length > 120 || !Number.isFinite(price) || price < 0 || price > 10000000 || !body.category_id) return fail("Enter a valid name, price, and category.", 400, auth);
    if (description.length > 1000) return fail("Description must be 1,000 characters or fewer.", 400, auth);
    if (imageUrl && !isCloudinaryUrl(imageUrl)) return fail("Menu photos must use a Cloudinary HTTPS URL.", 400, auth);
    const ingredientLinks = body.ingredients ?? [];
    if (!Array.isArray(ingredientLinks) || ingredientLinks.length > 100 || ingredientLinks.some((link) => !link.ingredient_id || !Number.isFinite(link.quantity_required) || link.quantity_required <= 0) || new Set(ingredientLinks.map((link) => link.ingredient_id)).size !== ingredientLinks.length) return fail("Check the ingredient links and quantities.", 400, auth);
    const { data: category, error: categoryError } = await db.from("menu_categories").select("id").eq("id", body.category_id).eq("tenant_id", auth.session.tenantId).maybeSingle();
    if (categoryError) throw categoryError;
    if (!category) return fail("Choose a category from this restaurant.", 400, auth);
    if (ingredientLinks.length) {
      const { data: ownedIngredients, error } = await db.from("ingredients").select("id").eq("tenant_id", auth.session.tenantId).in("id", ingredientLinks.map((link) => link.ingredient_id));
      if (error) throw error;
      if (ownedIngredients?.length !== ingredientLinks.length) return fail("One or more selected ingredients are unavailable for this restaurant.", 400, auth);
    }
    const values = { tenant_id: auth.session.tenantId, name, price, category_id: body.category_id, description: description || null, image_url: imageUrl, in_stock: typeof body.in_stock === "boolean" ? body.in_stock : true };
    let itemId = body.id;
    if (itemId) {
      const { data, error } = await db.from("menu_items").update(values).eq("id", itemId).eq("tenant_id", auth.session.tenantId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return fail("Menu item not found.", 404, auth);
      itemId = data.id;
    } else {
      const { data, error } = await db.from("menu_items").insert(values).select("id").single();
      if (error) throw error;
      itemId = data.id;
    }
    const { error: removeLinksError } = await db.from("menu_item_ingredients").delete().eq("menu_item_id", itemId);
    if (removeLinksError) throw removeLinksError;
    if (ingredientLinks.length) {
      const { error } = await db.from("menu_item_ingredients").insert(ingredientLinks.map((link) => ({ menu_item_id: itemId, ingredient_id: link.ingredient_id, quantity_required: link.quantity_required })));
      if (error) throw error;
    }
    return respond(NextResponse.json({ ok: true, id: itemId }, { status: body.id ? 200 : 201 }), auth);
  } catch (error) { return fail(error instanceof Error ? error.message : "Could not save menu item.", 503, auth); }
}
