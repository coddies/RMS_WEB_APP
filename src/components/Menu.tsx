"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";

type SpecialOffer = {
  id: string;
  menu_item_id: string;
  card_style: "flame" | "gradient" | "ribbon" | "countdown" | "seasonal_frame" | string;
  badge_text: string | null;
  days_of_week: string[] | null;
  start_at: string | null;
  end_at: string | null;
  run_indefinitely: boolean;
};

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  in_stock: boolean;
};

type Category = {
  id: string;
  name: string;
  sort_order?: number;
  menu_items: MenuItem[];
};

type MenuData = {
  tenant: {
    brand_name: string;
    primary_color: string | null;
    whatsapp_phone: string | null;
    logo_url: string | null;
  };
  table: { table_number: string } | null;
  categories: Category[];
  special_offers?: SpecialOffer[];
};

type CustomerOrderForm = {
  name: string;
  phone: string;
  address: string;
  website: string;
};

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  return digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
}

export default function Menu() {
  const [tenantSlug, setTenantSlug] = useState("demo");
  const [tableParam, setTableParam] = useState("");
  const [isDineIn, setIsDineIn] = useState(false);
  const [takeawayChoice, setTakeawayChoice] = useState<"delivery" | "pickup">("delivery");

  const [data, setData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [savedItems, setSavedItems] = useState<Record<string, boolean>>({});
  const itemDialogRef = useRef<HTMLDialogElement>(null);
  const [sending, setSending] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<string | null>(null);

  // Form State for Delivery / Pickup
  const [customerForm, setCustomerForm] = useState<CustomerOrderForm>({
    name: "",
    phone: "",
    address: "",
    website: ""
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [whatsAppNotice, setWhatsAppNotice] = useState("");
  const [whatsAppLink, setWhatsAppLink] = useState("");

  useEffect(() => {
    if (!selectedItem) return;
    const dialog = itemDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog?.open) dialog.close();
    };
  }, [selectedItem]);

  useEffect(() => {
    if (!cartDrawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCartDrawerOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cartDrawerOpen]);

  // Determine Entry Mode on Load (B2)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tenant = params.get("tenant") || "demo";
    const table = params.get("table") || "";
    const type = params.get("type");

    setTenantSlug(tenant);
    setTableParam(table);

    // If QR code scanned with table or type=dinein -> Dine-In
    if (table || type === "dinein") {
      setIsDineIn(true);
    } else {
      setIsDineIn(false);
    }
  }, []);

  // Fetch Menu Data
  useEffect(() => {
    let active = true;

    async function fetchMenu() {
      try {
        const query = new URLSearchParams({ tenant: tenantSlug });
        if (tableParam) query.set("table", tableParam);

        const res = await fetch(`/api/menu?${query.toString()}`, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) throw new Error(json.error ?? "Unable to load restaurant menu.");

        if (active) {
          setData(json);
          setError("");
          setLoading(false);

          // Purge sold-out items from cart
          const validIds = new Set(
            json.categories.flatMap((cat: Category) =>
              cat.menu_items.filter((i) => i.in_stock).map((i) => i.id)
            )
          );
          setCart((prev) => {
            const next: Record<string, number> = {};
            for (const [id, count] of Object.entries(prev)) {
              if (validIds.has(id)) next[id] = count;
            }
            return next;
          });
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load menu.");
          setLoading(false);
        }
      }
    }

    void fetchMenu();
    const interval = window.setInterval(fetchMenu, 6000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [tenantSlug, tableParam]);

  const allItems = data?.categories.flatMap((c) => c.menu_items) ?? [];
  const itemsById = new Map(allItems.map((i) => [i.id, i]));

  // Active Special Offers (A6)
  const today = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()];
  const activeSpecialOffers = (data?.special_offers || [])
    .map((o) => {
      const it = itemsById.get(o.menu_item_id);
      return it ? { ...o, item: it } : null;
    })
    .filter(Boolean)
    .filter((o) => {
      if (!o) return false;
      // Day of week check
      if (o.days_of_week && o.days_of_week.length > 0) {
        const lower = o.days_of_week.map((d) => d.toLowerCase().slice(0, 3));
        if (!lower.includes(today)) return false;
      }
      // Date window check
      if (!o.run_indefinitely) {
        const now = Date.now();
        if (o.start_at && new Date(o.start_at).getTime() > now) return false;
        if (o.end_at && new Date(o.end_at).getTime() < now) return false;
      }
      return true;
    }) as (SpecialOffer & { item: MenuItem })[];

  // Cart Helpers
  const cartTotalQty = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotalAmount = Object.entries(cart).reduce((sum, [id, qty]) => {
    const it = itemsById.get(id);
    return sum + (it ? it.price * qty : 0);
  }, 0);

  const visibleCategories = (data?.categories || [])
    .filter((category) => !activeCategory || category.id === activeCategory)
    .map((category) => ({
      ...category,
      menu_items: category.menu_items.filter((item) => {
        const query = searchQuery.trim().toLocaleLowerCase();
        return !query || category.name.toLocaleLowerCase().includes(query) || `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(query);
      }),
    }))
    .filter((category) => category.menu_items.length > 0);

  function updateCart(id: string, delta: number) {
    setCart((prev) => {
      const cur = prev[id] || 0;
      const next = cur + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      return { ...prev, [id]: next };
    });
  }

  function openItemDetail(item: MenuItem) {
    setSelectedItem(item);
    setSelectedQuantity(1);
  }

  function addSelectedItemToCart() {
    if (!selectedItem?.in_stock) return;
    updateCart(selectedItem.id, selectedQuantity);
    setSelectedItem(null);
  }

  function toggleSavedItem(id: string) {
    setSavedItems((previous) => ({ ...previous, [id]: !previous[id] }));
  }

  // Field validations
  const cleanPhone = customerForm.phone.replace(/[\s-]/g, "");
  const isNameValid = customerForm.name.trim().length >= 2;
  const isPhoneValid = /^03\d{9}$/.test(cleanPhone);
  const isAddressValid = takeawayChoice === "pickup" || customerForm.address.trim().length >= 10;
  const isFormValid = isNameValid && isPhoneValid && isAddressValid;

  // ── SUBMIT DINE-IN ORDER (Table QR -> Kitchen directly, no WhatsApp) ──
  async function submitDineInOrder() {
    if (cartTotalQty === 0) return;
    setSending(true);
    setError("");

    try {
      const payload = {
        order_type: "DINE_IN",
        tenant_slug: tenantSlug,
        table_number: data?.table?.table_number || tableParam || "T-01",
        items: Object.entries(cart).map(([item_id, quantity]) => ({ item_id, quantity }))
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to submit table order.");

      setConfirmedOrder(String(result.order_number ?? "RECEIVED"));
      setCart({});
      setCartDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place order.");
    } finally {
      setSending(false);
    }
  }

  // ── SUBMIT TAKEAWAY ORDER (Delivery or Pickup -> wa.me WhatsApp) (B2) ──
  async function submitTakeawayOrder(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, phone: true, address: true });
    setError("");
    setWhatsAppNotice("");

    if (!isFormValid || cartTotalQty === 0) return;
    if (customerForm.website) return; // Honeypot check

    const popup = window.open("about:blank", "_blank");
    setSending(true);

    try {
      const orderType = takeawayChoice === "pickup" ? "PICKUP" : "DELIVERY";
      const payload = {
        order_type: orderType,
        tenant_slug: tenantSlug,
        customer_name: customerForm.name.trim(),
        customer_phone: cleanPhone,
        customer_address: takeawayChoice === "delivery" ? customerForm.address.trim() : null,
        website: customerForm.website,
        items: Object.entries(cart).map(([item_id, quantity]) => ({ item_id, quantity }))
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Order could not be saved.");

      setConfirmedOrder(String(result.order_number ?? "RECEIVED"));
      setCart({});
      setCartDrawerOpen(false);

      const restPhone = normalizeWhatsAppNumber(data?.tenant.whatsapp_phone);
      if (restPhone.length < 10) {
        popup?.close();
        setWhatsAppNotice("Your order was received! Staff will contact you directly.");
        return;
      }

      // Build WhatsApp message
      const summaryLines = [
        `*${orderType} ORDER #${result.order_number}* — ${data?.tenant.brand_name ?? "Restaurant"}`,
        `Customer: *${customerForm.name.trim()}*`,
        `Phone: *${cleanPhone}*`,
        ...(orderType === "DELIVERY" ? [`Delivery Address: ${customerForm.address.trim()}`] : [`Order Type: *Self-Pickup at Counter*`]),
        "",
        "*Items Ordered:*",
        ...(result.items as { name?: string; quantity: number; price_at_order?: number }[]).map(
          (i) => `• ${i.quantity}x ${itemsById.get((i as { item_id?: string }).item_id ?? "")?.name || i.name || "Item"}`
        ),
        "",
        `*Total: Rs. ${Number(result.total_amount || cartTotalAmount).toLocaleString()}*`,
        "",
        "Please confirm our order. Thank you!"
      ].join("\n");

      const waUrl = `https://wa.me/${restPhone}?text=${encodeURIComponent(summaryLines)}`;
      setWhatsAppLink(waUrl);

      if (popup) {
        popup.opener = null;
        popup.location.replace(waUrl);
      } else {
        setWhatsAppNotice("Order saved! Tap below to open WhatsApp and send your order details.");
      }
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : "Failed to place order.");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="menu-loading" role="status">
        <span className="menu-loading-mark">✦</span>
        <span>Loading your menu…</span>
      </div>
    );
  }

  const brandName = data?.tenant.brand_name || "Ignite Smokehouse & Grill";
  const tableName = data?.table?.table_number || tableParam;

  return (
    <div className="menu-page menu-customer-page" style={{ "--tenant-accent": data?.tenant.primary_color || "#ff5a1f" } as CSSProperties}>
      <main className="menu-main">
        {confirmedOrder && (
          <section className="menu-order-confirmation" aria-live="polite">
            <span className="menu-confirmation-mark" aria-hidden="true">✓</span>
            <div>
              <strong>Order #{confirmedOrder} placed</strong>
              <p>{isDineIn ? "The kitchen received your ticket and is preparing your meal." : "Thank you for ordering with us!"}</p>
              {whatsAppLink && <a href={whatsAppLink} target="_blank" rel="noopener noreferrer">Open WhatsApp chat</a>}
            </div>
          </section>
        )}

        {error && <div className="menu-error" role="alert">{error}</div>}
        {whatsAppNotice && <div className="menu-notice" role="status">{whatsAppNotice}</div>}

        <section className="menu-welcome" aria-labelledby="restaurant-title">
          <div className="menu-welcome-copy">
            {data?.tenant.logo_url && <img className="menu-brand-logo" src={data.tenant.logo_url} alt={`${brandName} logo`} />}
            <p className="menu-eyebrow">{isDineIn ? `DINE IN · TABLE ${tableName || "T-01"}` : "FRESH FROM OUR KITCHEN"}</p>
            <h1 id="restaurant-title">What are you craving today?</h1>
            <p>Explore the menu at <strong>{brandName}</strong> and find your next favourite.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            {isDineIn ? (
              <span className="menu-mode-pill">Table {tableName || "T-01"}</span>
            ) : (
              <span className="menu-mode-pill">Delivery &amp; pickup</span>
            )}
            <Link
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                minHeight: "42px",
                padding: "0 16px",
                borderRadius: "999px",
                background: "#1c1c1e",
                color: "#ffffff",
                fontSize: "0.82rem",
                fontWeight: 700,
                textDecoration: "none",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
              </svg>
              <span>Staff Login</span>
            </Link>
          </div>
        </section>

        <div className="menu-discovery-row">
          <label className="menu-search" htmlFor="menu-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
            <input
              id="menu-search"
              type="search"
              placeholder="Search dishes and categories"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery && <button type="button" aria-label="Clear search" onClick={() => setSearchQuery("")}>×</button>}
          </label>
          <button className="menu-header-cart" type="button" onClick={() => setCartDrawerOpen(true)} aria-label={`Open cart, ${cartTotalQty} items`}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 9H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>
            <span>Cart</span>
            {cartTotalQty > 0 && <b>{cartTotalQty}</b>}
          </button>
        </div>

        {activeSpecialOffers.length > 0 && (
          <section className="menu-offers" aria-labelledby="offers-title">
            <div className="menu-section-heading menu-offers-heading">
              <div><p className="menu-eyebrow">A LITTLE SOMETHING EXTRA</p><h2 id="offers-title">Today&apos;s special</h2></div>
              {activeSpecialOffers.length > 1 && <span>{activeSpecialOffers.length} offers</span>}
            </div>
            <div className="menu-offer-track">
              {activeSpecialOffers.map((offer) => {
                const qty = cart[offer.item.id] || 0;
                return (
                  <article className="menu-offer-card" key={offer.id}>
                    <button className="menu-offer-image menu-detail-trigger" type="button" aria-label={`View ${offer.item.name}`} onClick={() => openItemDetail(offer.item)}>
                      {offer.item.image_url ? <img src={offer.item.image_url} alt={offer.item.name} /> : <span aria-hidden="true">✦</span>}
                    </button>
                    <div className="menu-offer-copy">
                      <span className="menu-offer-badge">{offer.badge_text || "SPECIAL OFFER"}</span>
                      <h3><button className="menu-offer-title-trigger" type="button" onClick={() => openItemDetail(offer.item)}>{offer.item.name}</button></h3>
                      <p>{offer.item.description || "A guest favourite, made fresh for you."}</p>
                      <div className="menu-offer-bottom">
                        <strong>Rs. {offer.item.price.toLocaleString()}</strong>
                        {!offer.item.in_stock ? <span className="menu-sold-out">Sold out</span> : qty === 0 ? (
                          <button className="menu-add-button menu-add-button-wide" type="button" onClick={() => updateCart(offer.item.id, 1)}>+ Add</button>
                        ) : (
                          <div className="menu-quantity-control" aria-label={`${qty} ${offer.item.name} in cart`}>
                            <button type="button" aria-label={`Remove one ${offer.item.name}`} onClick={() => updateCart(offer.item.id, -1)}>−</button><span>{qty}</span><button type="button" aria-label={`Add one ${offer.item.name}`} onClick={() => updateCart(offer.item.id, 1)}>+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <section className="menu-category-section" aria-label="Menu categories">
          <div className="menu-section-heading"><div><p className="menu-eyebrow">FIND YOUR FAVOURITE</p><h2>Browse categories</h2></div></div>
          <div className="menu-category-list">
            <button className={`menu-category-chip${activeCategory === "" ? " is-active" : ""}`} type="button" aria-pressed={activeCategory === ""} onClick={() => setActiveCategory("")}>
              <span className="menu-category-image menu-category-all">✦</span><span>All menu</span>
            </button>
            {data?.categories.map((category) => {
              const categoryImage = category.menu_items.find((item) => item.image_url)?.image_url;
              return (
                <button className={`menu-category-chip${activeCategory === category.id ? " is-active" : ""}`} key={category.id} type="button" aria-pressed={activeCategory === category.id} onClick={() => setActiveCategory(category.id)}>
                  <span className="menu-category-image">{categoryImage ? <img src={categoryImage} alt="" /> : <span aria-hidden="true">{category.name.slice(0, 1).toUpperCase()}</span>}</span><span>{category.name}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="menu-items-section" aria-labelledby="menu-items-title">
          <div className="menu-section-heading menu-items-heading">
            <div><p className="menu-eyebrow">MADE TO ORDER</p><h2 id="menu-items-title">{searchQuery ? "Search results" : activeCategory ? data?.categories.find((category) => category.id === activeCategory)?.name : "Explore the menu"}</h2></div>
            <span>{visibleCategories.reduce((count, category) => count + category.menu_items.length, 0)} items</span>
          </div>
          {visibleCategories.length === 0 ? (
            <div className="menu-empty-state"><span aria-hidden="true">⌕</span><h3>No dishes found</h3><p>Try another search or choose a different category.</p><button type="button" onClick={() => { setSearchQuery(""); setActiveCategory(""); }}>Show the full menu</button></div>
          ) : (
            <div className="menu-category-groups">
              {visibleCategories.map((category) => (
                <section className="menu-category-group" key={category.id} aria-labelledby={`category-${category.id}`}>
                  {!activeCategory && !searchQuery && <div className="menu-category-title"><h3 id={`category-${category.id}`}>{category.name}</h3><span>{category.menu_items.length} dishes</span></div>}
                  <div className="menu-item-grid">
                    {category.menu_items.map((item) => {
                      const qty = cart[item.id] || 0;
                      return (
                        <article className={`menu-product-card${!item.in_stock ? " is-sold-out" : ""}`} key={item.id}>
                          <button className="menu-product-image menu-detail-trigger" type="button" aria-label={`View ${item.name} details`} onClick={() => openItemDetail(item)}>
                            {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" /> : <span aria-hidden="true">✦</span>}
                            {!item.in_stock && <span className="menu-product-sold-badge">Sold out</span>}
                          </button>
                          <div className="menu-product-details">
                            <div className="menu-product-title-row"><h4><button className="menu-product-title-trigger" type="button" onClick={() => openItemDetail(item)}>{item.name}</button></h4><strong>Rs. {item.price.toLocaleString()}</strong></div>
                            {item.description && <p>{item.description}</p>}
                            <div className="menu-product-actions">
                              <span>{item.in_stock ? "Made fresh" : "Currently unavailable"}</span>
                              {!item.in_stock ? <span className="menu-sold-out-label">Sold out</span> : qty === 0 ? (
                                <button className="menu-add-button" type="button" aria-label={`Add ${item.name} to cart`} onClick={() => updateCart(item.id, 1)}>+</button>
                              ) : (
                                <div className="menu-quantity-control" aria-label={`${qty} ${item.name} in cart`}>
                                  <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => updateCart(item.id, -1)}>−</button><span>{qty}</span><button type="button" aria-label={`Add one ${item.name}`} onClick={() => updateCart(item.id, 1)}>+</button>
                                </div>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        <footer className="menu-footer">
          <span>{brandName}</span><span>·</span><Link href="/privacy">Privacy Policy</Link><span>·</span><Link href="/login">Staff Login</Link>
        </footer>
      </main>

      {/* ── STICKY BOTTOM CART BAR ── */}
      {cartTotalQty > 0 && !cartDrawerOpen && (
        <div className="menu-cart-bar">
          <div className="menu-cart-bar-inner">
            <div className="menu-cart-summary">
              <span>{cartTotalQty} {cartTotalQty === 1 ? "item" : "items"} in your cart</span>
              <strong>
                Rs. {cartTotalAmount.toLocaleString()}
              </strong>
            </div>

            <button className="menu-review-cart" type="button" onClick={() => setCartDrawerOpen(true)}>
              Review cart <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}

      {selectedItem && (
        <dialog
          className="menu-item-dialog"
          ref={itemDialogRef}
          aria-labelledby="menu-item-dialog-title"
          onClose={() => setSelectedItem(null)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedItem(null);
          }}
          onCancel={(event) => {
            event.preventDefault();
            setSelectedItem(null);
          }}
        >
          <div className="menu-detail-content-shell">
            <div className="menu-detail-hero">
              {selectedItem.image_url ? <img src={selectedItem.image_url} alt={selectedItem.name} /> : <span aria-hidden="true">✦</span>}
              <button className="menu-detail-back" type="button" aria-label="Close item details" onClick={() => setSelectedItem(null)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
              </button>
              <button
                className={`menu-detail-heart${savedItems[selectedItem.id] ? " is-saved" : ""}`}
                type="button"
                aria-label={savedItems[selectedItem.id] ? "Remove from favourites" : "Add to favourites"}
                aria-pressed={Boolean(savedItems[selectedItem.id])}
                onClick={() => toggleSavedItem(selectedItem.id)}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill={savedItems[selectedItem.id] ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></svg>
              </button>
            </div>

            <div className="menu-detail-body">
              <p className="menu-eyebrow">{selectedItem.in_stock ? "MADE FRESH TO ORDER" : "CURRENTLY UNAVAILABLE"}</p>
              <div className="menu-detail-title-row">
                <h2 id="menu-item-dialog-title">{selectedItem.name}</h2>
                <strong>Rs. {selectedItem.price.toLocaleString()}</strong>
              </div>
              <p className="menu-detail-description">{selectedItem.description || "Prepared fresh in our kitchen with care."}</p>

              {selectedItem.in_stock ? (
                <div className="menu-detail-quantity-row">
                  <div><strong>Quantity</strong><span>Choose how many you&apos;d like</span></div>
                  <div className="menu-detail-quantity" aria-label="Item quantity">
                    <button type="button" aria-label="Decrease quantity" disabled={selectedQuantity <= 1} onClick={() => setSelectedQuantity((quantity) => Math.max(1, quantity - 1))}>−</button>
                    <span aria-live="polite">{selectedQuantity}</span>
                    <button type="button" aria-label="Increase quantity" onClick={() => setSelectedQuantity((quantity) => quantity + 1)}>+</button>
                  </div>
                </div>
              ) : (
                <div className="menu-detail-unavailable">This item is sold out right now.</div>
              )}
            </div>

            <div className="menu-detail-cta-wrap">
              <button className="menu-detail-cta" type="button" disabled={!selectedItem.in_stock} onClick={addSelectedItemToCart}>
                {selectedItem.in_stock ? `Add to Cart · Rs. ${(selectedItem.price * selectedQuantity).toLocaleString()}` : "Currently unavailable"}
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* ── EXPANDABLE CART DRAWER (B2: DINE-IN vs DELIVERY / PICKUP) ── */}
      {cartDrawerOpen && (
        <div className="menu-cart-backdrop" role="presentation" onClick={() => setCartDrawerOpen(false)}>
          <section className="menu-cart-dialog" role="dialog" aria-modal="true" aria-labelledby="menu-cart-title" onClick={(event) => event.stopPropagation()}>
            <header className="menu-cart-header">
              <div><p className="menu-eyebrow">YOUR ORDER</p><h2 id="menu-cart-title">Review your cart</h2><span>{cartTotalQty} {cartTotalQty === 1 ? "item" : "items"}</span></div>
              <button className="menu-cart-close" type="button" aria-label="Close cart" onClick={() => setCartDrawerOpen(false)}>×</button>
            </header>

            {cartTotalQty === 0 ? (
              <div className="menu-cart-empty"><span aria-hidden="true">＋</span><h3>Your cart is empty</h3><p>Add a dish from the menu to get started.</p><button type="button" onClick={() => setCartDrawerOpen(false)}>Back to menu</button></div>
            ) : (
              <>
                <div className="menu-cart-items">
                  {Object.entries(cart).map(([id, qty]) => {
                    const item = itemsById.get(id);
                    if (!item) return null;
                    return (
                      <article className="menu-cart-item" key={id}>
                        <div className="menu-cart-item-image">
                          {item.image_url ? <img src={item.image_url} alt="" /> : <span aria-hidden="true">✦</span>}
                        </div>
                        <div className="menu-cart-item-copy"><h3>{item.name}</h3><span>Rs. {item.price.toLocaleString()} each</span><strong>Rs. {(item.price * qty).toLocaleString()}</strong></div>
                        <div className="menu-quantity-control" aria-label={`${qty} ${item.name} in cart`}>
                          <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => updateCart(id, -1)}>−</button><span>{qty}</span><button type="button" aria-label={`Add one ${item.name}`} onClick={() => updateCart(id, 1)}>+</button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <section className="menu-bill-summary" aria-label="Bill summary">
                  <div><span>Items subtotal</span><strong>Rs. {cartTotalAmount.toLocaleString()}</strong></div>
                  <div><span>{isDineIn ? `Dine in · Table ${tableName || "T-01"}` : takeawayChoice === "pickup" ? "Self pickup" : "Delivery fee"}</span><strong>{isDineIn || takeawayChoice === "pickup" ? "No extra charge" : "Confirmed by restaurant"}</strong></div>
                  <div className="menu-bill-total"><span>Total</span><strong>Rs. {cartTotalAmount.toLocaleString()}</strong></div>
                </section>

                {isDineIn ? (
                  <div className="menu-checkout-panel">
                    <div className="menu-checkout-context"><strong>Table {tableName || "T-01"} dine-in order</strong><span>Your order will be sent directly to the kitchen.</span></div>
                    <button className="menu-place-order" type="button" disabled={sending || cartTotalQty === 0} onClick={submitDineInOrder}>
                      {sending ? "Sending order…" : "Place table order"}
                    </button>
                  </div>
                ) : (
                  <form className="menu-checkout-panel" onSubmit={submitTakeawayOrder}>
                    <div className="menu-checkout-heading"><p className="menu-eyebrow">DELIVERY DETAILS</p><h3>How should we get it to you?</h3></div>
                    <div className="menu-order-type" role="group" aria-label="Choose delivery or pickup">
                      <button className={takeawayChoice === "delivery" ? "is-selected" : ""} type="button" aria-pressed={takeawayChoice === "delivery"} onClick={() => setTakeawayChoice("delivery")}>Door delivery</button>
                      <button className={takeawayChoice === "pickup" ? "is-selected" : ""} type="button" aria-pressed={takeawayChoice === "pickup"} onClick={() => setTakeawayChoice("pickup")}>Self pickup</button>
                    </div>

                    <label className="menu-form-field" htmlFor="customer-name">Your name
                      <input id="customer-name" type="text" autoComplete="name" placeholder="e.g. Ali Ahmed" value={customerForm.name} onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })} onBlur={() => setTouched((previous) => ({ ...previous, name: true }))} required />
                      {touched.name && !isNameValid && <span className="menu-field-error">Enter at least 2 characters.</span>}
                    </label>

                    <label className="menu-form-field" htmlFor="customer-phone">Mobile number
                      <input id="customer-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="03XXXXXXXXX" value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} onBlur={() => setTouched((previous) => ({ ...previous, phone: true }))} required />
                      {touched.phone && !isPhoneValid && <span className="menu-field-error">Enter 11 digits starting with 03.</span>}
                    </label>

                    {takeawayChoice === "delivery" && (
                      <label className="menu-form-field" htmlFor="customer-address">Delivery address
                        <textarea id="customer-address" autoComplete="street-address" placeholder="Street, house number, block and nearby landmark" value={customerForm.address} onChange={(event) => setCustomerForm({ ...customerForm, address: event.target.value })} onBlur={() => setTouched((previous) => ({ ...previous, address: true }))} rows={3} required />
                        {touched.address && !isAddressValid && <span className="menu-field-error">Add an address with at least 10 characters.</span>}
                      </label>
                    )}

                    <label className="delivery-honeypot" aria-hidden="true" tabIndex={-1}>Website
                      <input type="text" name="website" autoComplete="off" tabIndex={-1} value={customerForm.website} onChange={(event) => setCustomerForm({ ...customerForm, website: event.target.value })} />
                    </label>

                    {error && <div className="menu-error" role="alert">{error}</div>}
                    <button className="menu-place-order" type="submit" disabled={sending || cartTotalQty === 0 || !isFormValid}>
                      {sending ? "Placing order…" : takeawayChoice === "pickup" ? "Place pickup order" : "Place delivery order"}
                    </button>
                    <p className="menu-checkout-note">Your order is saved first. WhatsApp opens next so you can send the details to the restaurant.</p>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
