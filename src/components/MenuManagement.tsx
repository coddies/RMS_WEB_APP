"use client";
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";

type Item = { id: string; name: string; price: number; category_id: string; image_url: string | null; description: string | null; in_stock: boolean };
type Category = { id: string; name: string; sort_order: number; menu_items: Item[] };
type Ingredient = { id: string; name: string; unit: string };
type IngredientLink = { menu_item_id: string; ingredient_id: string; quantity_required: number };
type MenuData = { categories: Category[]; ingredients: Ingredient[]; links: IngredientLink[] };
type FormState = { id?: string; name: string; price: string; category_id: string; description: string; image_url: string | null; in_stock: boolean; ingredients: Record<string, string> };
const blank: FormState = { name: "", price: "", category_id: "", description: "", image_url: null, in_stock: true, ingredients: {} };

async function compressedImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose a photo smaller than 12 MB.");
  const bitmap = await createImageBitmap(file); const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d"); if (!context) throw new Error("This browser could not prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Photo compression failed.")), "image/jpeg", 0.82));
}

export default function MenuManagement() {
  const [data, setData] = useState<MenuData>({ categories: [], ingredients: [], links: [] }); const [form, setForm] = useState<FormState>(blank); const [editing, setEditing] = useState(false); const [photo, setPhoto] = useState<File | null>(null); const [photoPreview, setPhotoPreview] = useState(""); const [search, setSearch] = useState(""); const [collapsed, setCollapsed] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/menu", { cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load menu."); setData(body);
  }, []);
  useEffect(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load menu.")); }, [load]);
  function startNew(categoryId = "") { setForm({ ...blank, category_id: categoryId || data.categories[0]?.id || "" }); setEditing(true); setPhoto(null); setPhotoPreview(""); setError(""); setNotice(""); }
  function startEdit(item: Item) {
    const linked = data.links.filter((link) => link.menu_item_id === item.id);
    setForm({ id: item.id, name: item.name, price: String(item.price), category_id: item.category_id, description: item.description ?? "", image_url: item.image_url, in_stock: item.in_stock, ingredients: Object.fromEntries(linked.map((link) => [link.ingredient_id, String(link.quantity_required)])) });
    setEditing(true); setPhoto(null); setPhotoPreview(item.image_url ?? ""); setError(""); setNotice("");
  }
  function choosePhoto(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0] ?? null; setPhoto(file); setPhotoPreview(file ? URL.createObjectURL(file) : form.image_url ?? ""); }
  async function uploadPhoto(file: File) {
    const blob = await compressedImage(file); const formData = new FormData(); formData.append("file", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
    const response = await fetch("/api/admin/menu/photo", { method: "POST", body: formData }); const result = await response.json();
    if (!response.ok || !result.secure_url) throw new Error(result.error ?? "Cloudinary could not upload this photo."); return result.secure_url as string;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      let imageUrl = form.image_url; if (photo) imageUrl = await uploadPhoto(photo);
      const ingredients = Object.entries(form.ingredients).filter(([, quantity]) => quantity !== "").map(([ingredient_id, quantity]) => ({ ingredient_id, quantity_required: Number(quantity) }));
      const response = await fetch("/api/admin/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", id: form.id, name: form.name, price: Number(form.price), category_id: form.category_id, description: form.description, image_url: imageUrl, in_stock: form.in_stock, ingredients }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not save item.");
      setEditing(false); setPhoto(null); setPhotoPreview(""); await load(); setNotice(form.id ? "Menu item updated." : "Menu item added.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save item."); } finally { setBusy(false); }
  }
  async function setStock(item: Item) {
    setError(""); const response = await fetch("/api/admin/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stock", id: item.id, in_stock: !item.in_stock }) }); const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Could not update stock."); return; } setData((current) => ({ ...current, categories: current.categories.map((category) => ({ ...category, menu_items: category.menu_items.map((row) => row.id === item.id ? { ...row, in_stock: !row.in_stock } : row) })) }));
  }
  async function remove(item: Item) {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    const response = await fetch("/api/admin/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: item.id }) }); const body = await response.json();
    if (!response.ok) { setError(body.error ?? "Could not delete item."); return; } await load(); setNotice("Menu item deleted.");
  }
  const query = search.trim().toLocaleLowerCase();
  return <main className="admin-menu-page"><header className="admin-menu-header"><div><p className="eyebrow">Restaurant admin</p><h1>Menu management</h1><p className="muted">Changes reach customer menus on their next refresh, within a few seconds.</p></div><button className="button" onClick={() => startNew()}>＋ Add New Item</button></header>
    <div className="menu-tools"><label className="menu-search"><span>Search menu</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by item name" /></label></div>
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p className="menu-notice" role="status">{notice}</p>}
    {!data.categories.length && <section className="panel"><h2>No menu categories found</h2><p className="muted">Create restaurant categories before adding menu items.</p></section>}
    {data.categories.map((category) => {
      const items = category.menu_items.filter((item) => !query || item.name.toLocaleLowerCase().includes(query));
      if (query && !items.length) return null;
      return <section className="admin-category" key={category.id}><button className="admin-category-heading" onClick={() => setCollapsed((current) => ({ ...current, [category.id]: !current[category.id] }))} aria-expanded={!collapsed[category.id]}><span>{collapsed[category.id] ? "＋" : "−"} {category.name}</span><span className="item-count">{items.length} item{items.length === 1 ? "" : "s"}</span></button>
        {!collapsed[category.id] && <div className="admin-item-list">{items.map((item) => <article className="admin-item-row" key={item.id}>{item.image_url ? <img src={item.image_url} alt="" className="admin-item-thumb" /> : <div className="admin-item-thumb photo-placeholder">{item.name.slice(0, 1)}</div>}<div className="admin-item-main"><strong>{item.name}</strong><span>Rs. {Number(item.price).toLocaleString()} <i>·</i> {category.name}</span></div><button className={`stock-toggle ${item.in_stock ? "is-stock" : "is-sold"}`} onClick={() => void setStock(item)} aria-pressed={item.in_stock}>{item.in_stock ? "In stock" : "Sold out"}</button><button className="icon-action" aria-label={`Edit ${item.name}`} onClick={() => startEdit(item)}>✎</button><button className="icon-action delete-action" aria-label={`Delete ${item.name}`} onClick={() => void remove(item)}>×</button></article>)}{!query && <button className="add-category-item" onClick={() => startNew(category.id)}>＋ Add item to {category.name}</button>}</div>}
      </section>;
    })}
    {editing && <div className="menu-dialog-backdrop"><section className="menu-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-form-title"><header><div><p className="eyebrow">Menu item</p><h2 id="menu-form-title">{form.id ? "Edit item" : "Add new item"}</h2></div><button className="icon-action" onClick={() => setEditing(false)} aria-label="Close">×</button></header><form onSubmit={submit}>
      <label className="photo-upload">Photo {photoPreview && <img src={photoPreview} alt="Selected menu item" /> }<input type="file" accept="image/*" onChange={choosePhoto} /></label>
      <div className="form-two-col"><label>Item name<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Price (Rs.)<input required min="0" max="10000000" step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label></div>
      <label>Category<select required value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}><option value="">Choose category</option>{data.categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
      <label>Description<textarea maxLength={1000} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <fieldset className="ingredient-picker"><legend>Link ingredients <span className="muted">(optional)</span></legend>{data.ingredients.length ? data.ingredients.map((ingredient) => { const selected = Object.hasOwn(form.ingredients, ingredient.id); return <div className="ingredient-option" key={ingredient.id}><label><input type="checkbox" checked={selected} onChange={(event) => { const next = { ...form.ingredients }; if (event.target.checked) next[ingredient.id] = "1"; else delete next[ingredient.id]; setForm({ ...form, ingredients: next }); }} />{ingredient.name} <span>{ingredient.unit}</span></label>{selected && <input aria-label={`${ingredient.name} quantity required`} min="0.001" step="any" type="number" value={form.ingredients[ingredient.id]} onChange={(event) => setForm({ ...form, ingredients: { ...form.ingredients, [ingredient.id]: event.target.value } })} />}</div>; }) : <p className="muted">No inventory ingredients yet.</p>}</fieldset>
      <label className="stock-checkbox"><input type="checkbox" checked={form.in_stock} onChange={(event) => setForm({ ...form, in_stock: event.target.checked })} /> Available to order</label>
      {error && <p className="inline-error" role="alert">{error}</p>}<footer><button type="button" className="cancel-button" onClick={() => setEditing(false)}>Cancel</button><button className="button" disabled={busy}>{busy ? "Saving…" : "Save item"}</button></footer>
    </form></section></div>}
  </main>;
}
