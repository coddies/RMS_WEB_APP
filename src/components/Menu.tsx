"use client";
import { FormEvent, useEffect, useState } from "react";
type MenuItem = { id: string; name: string; description: string | null; price: number; image_url: string | null; in_stock: boolean };
type Category = { id: string; name: string; menu_items: MenuItem[] };
type MenuData = { tenant: { brand_name: string; primary_color: string | null; whatsapp_phone: string | null }; table: { table_number: string } | null; categories: Category[] };
type DeliveryForm = { name: string; phone: string; address: string; website: string };
type MenuRoute = { tenant: string; table: string; type: string | null; delivery: boolean };
function cloudinaryImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !url.pathname.includes("/image/upload/")) return null;
    url.pathname = url.pathname.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_600,h_600,c_fill/");
    return url.toString();
  } catch { return null; }
}
function whatsappNumber(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
}
export default function Menu() {
  const [route, setRoute] = useState<MenuRoute | null>(null);
  const tenant = route?.tenant ?? ""; const table = route?.table ?? ""; const delivery = route?.delivery ?? false;
  const [data, setData] = useState<MenuData | null>(null); const [error, setError] = useState(""); const [cart, setCart] = useState<Record<string, number>>({}); const [sending, setSending] = useState(false); const [orderNumber, setOrderNumber] = useState(""); const [category, setCategory] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false); const [touched, setTouched] = useState<Record<string, boolean>>({}); const [deliveryForm, setDeliveryForm] = useState<DeliveryForm>({ name: "", phone: "", address: "", website: "" }); const [whatsAppLink, setWhatsAppLink] = useState(""); const [whatsAppNotice, setWhatsAppNotice] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let tenantSlug = params.get("tenant") ?? "";
    if (!tenantSlug) {
      try {
        const host = window.location.hostname;
        const root = process.env.NEXT_PUBLIC_BASE_URL ? new URL(process.env.NEXT_PUBLIC_BASE_URL).hostname : "";
        if (root && host.endsWith(`.${root}`)) tenantSlug = host.slice(0, -(root.length + 1)).split(".")[0];
      } catch { tenantSlug = ""; }
    }
    const tableNumber = params.get("table") ?? "";
    const type = params.get("type");
    setRoute({ tenant: tenantSlug, table: tableNumber, type, delivery: type === "delivery" || !tableNumber });
  }, []);
  useEffect(() => {
    if (!route) return;
    if (!tenant || (!delivery && route.type !== "dinein")) { setError("Open this menu using your restaurant’s menu link or table QR code."); return; }
    let active = true;
    async function refresh() {
      try {
        const query = new URLSearchParams({ tenant }); if (!delivery && table) query.set("table", table);
        const response = await fetch(`/api/menu?${query}`, { cache: "no-store" }); const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not load menu.");
        if (active) { setData(body); setError(""); setCart((current) => Object.fromEntries(Object.entries(current).filter(([id]) => body.categories.some((group: Category) => group.menu_items.some((item: MenuItem) => item.id === id && item.in_stock))))); }
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not refresh menu."); }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [route, tenant, table, delivery]);
  const items = data?.categories.flatMap((group) => group.menu_items) ?? []; const cartCount = Object.values(cart).reduce((sum, count) => sum + count, 0); const total = items.reduce((sum, item) => sum + item.price * (cart[item.id] ?? 0), 0);
  const phone = deliveryForm.phone.replace(/[\s-]/g, "");
  const fieldErrors = { name: deliveryForm.name.trim().length < 2 ? "Name must be at least 2 characters." : deliveryForm.name.trim().length > 120 ? "Name must be 120 characters or fewer." : "", phone: /^03\d{9}$/.test(phone) ? "" : "Enter a Pakistani mobile number in 03XXXXXXXXX format.", address: deliveryForm.address.trim().length < 10 ? "Address must be at least 10 characters." : deliveryForm.address.trim().length > 500 ? "Address must be 500 characters or fewer." : "" };
  const formValid = !fieldErrors.name && !fieldErrors.phone && !fieldErrors.address && cartCount > 0;
  const returnParams = new URLSearchParams({ type: delivery ? "delivery" : "dinein" }); if (route?.tenant) returnParams.set("tenant", tenant); if (!delivery && table) returnParams.set("table", table);
  const privacyUrl = `/menu?${returnParams.toString()}`;
  function add(item: MenuItem) { if (item.in_stock) setCart((current) => ({ ...current, [item.id]: Math.min((current[item.id] ?? 0) + 1, 99) })); }
  async function submitDineIn() {
    setSending(true); setError("");
    try { const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant_slug: tenant, table_number: table, items: Object.entries(cart).map(([item_id, quantity]) => ({ item_id, quantity })) }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Order could not be submitted."); setOrderNumber(String(result.order_number)); setCart({}); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Order could not be submitted."); } finally { setSending(false); }
  }
  async function submitDelivery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setTouched({ name: true, phone: true, address: true }); setError(""); setWhatsAppNotice("");
    if (!formValid) return;
    const popup = window.open("about:blank", "_blank"); setSending(true);
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_type: "DELIVERY", tenant_slug: tenant, customer_name: deliveryForm.name.trim(), customer_phone: phone, customer_address: deliveryForm.address.trim(), website: deliveryForm.website, items: Object.entries(cart).map(([item_id, quantity]) => ({ item_id, quantity })) }) });
      const result = await response.json();
      if (result.ignored) { popup?.close(); return; }
      if (!response.ok) throw new Error(result.error ?? "Delivery order could not be submitted.");
      setOrderNumber(String(result.order_number)); setCart({}); setCheckoutOpen(false);
      const restaurantPhone = whatsappNumber(data?.tenant.whatsapp_phone);
      if (restaurantPhone.length < 10) { popup?.close(); setWhatsAppNotice("Your order was saved, but the restaurant has not configured its WhatsApp number yet."); return; }
      const summary = [
        `Delivery order #${result.order_number} — ${data?.tenant.brand_name ?? "Restaurant"}`,
        `Name: ${deliveryForm.name.trim()}`,
        `Phone: ${phone}`,
        `Address: ${deliveryForm.address.trim()}`,
        "Items:",
        ...(result.items as { name: string; quantity: number; price: number }[]).map((item) => `${item.quantity} × ${item.name} — Rs. ${Number(item.price).toLocaleString()}`),
        `Total: Rs. ${Number(result.total_amount).toLocaleString()}`,
      ].join("\n");
      const link = `https://wa.me/${restaurantPhone}?text=${encodeURIComponent(summary)}`; setWhatsAppLink(link);
      if (popup) { popup.opener = null; popup.location.replace(link); } else setWhatsAppNotice("Order saved. Tap the WhatsApp link below to send it to the restaurant.");
    } catch (reason) { popup?.close(); setError(reason instanceof Error ? reason.message : "Delivery order could not be submitted."); }
    finally { setSending(false); }
  }
  if (error && !data) return <main className="center-page"><section className="panel"><p className="eyebrow">Restaurant menu</p><h1>Menu unavailable</h1><p className="error-text">{error}</p></section></main>;
  const shownCategories = data?.categories.filter((group) => !category || group.id === category) ?? [];
  return <main className="menu-page" style={{ "--tenant-accent": data?.tenant.primary_color || "#dc2626" } as React.CSSProperties}>
    <header className="menu-header"><div><p className="eyebrow">Welcome to</p><h1>{data?.tenant.brand_name ?? "Loading menu…"}</h1></div><span className="table-badge">{!route ? "Loading table…" : delivery ? "Delivery / Takeaway" : `Table ${data?.table?.table_number ?? table} · Dine In`}</span></header>
    {orderNumber && <p className="menu-notice" role="status">Order #{orderNumber} saved{delivery ? " for the restaurant" : " and sent to the kitchen"}.</p>}{whatsAppNotice && <p className="menu-notice" role="status">{whatsAppNotice} {whatsAppLink && <a href={whatsAppLink} target="_blank" rel="noreferrer">Open WhatsApp</a>}</p>}
    <nav className="category-tabs" aria-label="Menu categories"><button className={!category ? "active" : ""} onClick={() => setCategory("")}>All</button>{data?.categories.map((group) => <button key={group.id} className={category === group.id ? "active" : ""} onClick={() => setCategory(group.id)}>{group.name}</button>)}</nav>
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="menu-content">{shownCategories.map((group) => <section key={group.id} className="menu-section"><h2>{group.name}</h2><div className="item-grid">{group.menu_items.map((item) => { const photoUrl = cloudinaryImageUrl(item.image_url); return <article className={`item-card ${!item.in_stock ? "sold-out" : ""}`} key={item.id}>{photoUrl ? <img src={photoUrl} alt="" className="item-photo" /> : <div className="item-photo photo-placeholder">{item.name.slice(0, 1)}</div>}<div className="item-info"><h3>{item.name}</h3><p>{item.description}</p><div className="item-bottom"><strong>Rs. {Number(item.price).toLocaleString()}</strong>{item.in_stock ? <button className="add-button" aria-label={`Add ${item.name}`} onClick={() => add(item)}>+</button> : <span className="sold-label">Sold out</span>}</div></div></article>; })}</div></section>)}</div>
    <a href={`/privacy?returnTo=${encodeURIComponent(privacyUrl)}`} className="privacy-link">Privacy Policy</a>
    {checkoutOpen && delivery && <div className="checkout-backdrop"><form className="panel delivery-checkout" onSubmit={submitDelivery}><header><div><p className="eyebrow">Delivery checkout</p><h2>Your details</h2></div><button type="button" className="icon-action" aria-label="Close checkout" onClick={() => setCheckoutOpen(false)}>×</button></header><p className="muted">Your order will be saved for the restaurant and prepared as a WhatsApp message.</p><label>Name<input value={deliveryForm.name} autoComplete="name" maxLength={120} onBlur={() => setTouched((current) => ({ ...current, name: true }))} onChange={(event) => setDeliveryForm((current) => ({ ...current, name: event.target.value }))} /></label>{touched.name && fieldErrors.name && <small className="inline-error">{fieldErrors.name}</small>}<label>Phone number<input value={deliveryForm.phone} inputMode="tel" autoComplete="tel" maxLength={14} placeholder="03XXXXXXXXX" onBlur={() => setTouched((current) => ({ ...current, phone: true }))} onChange={(event) => setDeliveryForm((current) => ({ ...current, phone: event.target.value }))} /></label>{touched.phone && fieldErrors.phone && <small className="inline-error">{fieldErrors.phone}</small>}<label>Delivery address<textarea value={deliveryForm.address} autoComplete="street-address" maxLength={500} rows={3} onBlur={() => setTouched((current) => ({ ...current, address: true }))} onChange={(event) => setDeliveryForm((current) => ({ ...current, address: event.target.value }))} /></label>{touched.address && fieldErrors.address && <small className="inline-error">{fieldErrors.address}</small>}<label className="delivery-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" value={deliveryForm.website} onChange={(event) => setDeliveryForm((current) => ({ ...current, website: event.target.value }))} /></label>{!whatsappNumber(data?.tenant.whatsapp_phone) && <p className="inline-error">Restaurant WhatsApp number is not configured; this order can be saved but not opened in WhatsApp.</p>}<footer><button type="button" className="cancel-button" onClick={() => setCheckoutOpen(false)}>Back to menu</button><button className="button" disabled={!formValid || sending}>{sending ? "Saving order…" : "Order via WhatsApp"}</button></footer></form></div>}
    {cartCount > 0 && <aside className="cart-bar"><div><strong>{cartCount} item{cartCount === 1 ? "" : "s"}</strong><span>Rs. {total.toLocaleString()}</span></div>{delivery ? <button className="button" onClick={() => setCheckoutOpen(true)}>Checkout</button> : <button className="button" onClick={submitDineIn} disabled={sending}>{sending ? "Sending…" : "Submit Order to Kitchen"}</button>}</aside>}
  </main>;
}
