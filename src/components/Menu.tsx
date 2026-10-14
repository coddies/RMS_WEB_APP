"use client";

import { FormEvent, useEffect, useState } from "react";
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
      <div style={{ minHeight: "100vh", background: "#0D0D0D", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading restaurant menu...
      </div>
    );
  }

  const brandName = data?.tenant.brand_name || "Ignite Smokehouse & Grill";
  const tableName = data?.table?.table_number || tableParam;

  return (
    <div style={{ minHeight: "100vh", background: "#0D0D0D", color: "#E5E2E1", fontFamily: "Inter, sans-serif", paddingBottom: "100px" }}>
      {/* ── TOP HEADER (B2: NO SWITCH BUTTON ON QR DINE-IN) ── */}
      <header
        style={{
          background: "#131313",
          borderBottom: "1px solid #222",
          position: "sticky",
          top: 0,
          zIndex: 40,
          padding: "14px 20px"
        }}
      >
        <div style={{ maxWidth: "680px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "#DC2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFF",
                fontWeight: "900",
                fontSize: "16px"
              }}
            >
              I
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "16px", color: "#FFF", fontWeight: "800", letterSpacing: "-0.01em" }}>
                {brandName.toUpperCase()}
              </h1>
              <span style={{ fontSize: "11px", color: "#8B949E" }}>Premium Smokehouse &amp; Grill</span>
            </div>
          </div>

          {/* Mode Pill Badge (B2) */}
          <div>
            {isDineIn ? (
              <span
                style={{
                  background: "#1E3A8A",
                  color: "#93C5FD",
                  fontSize: "11px",
                  fontWeight: "800",
                  padding: "5px 12px",
                  borderRadius: "999px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#60A5FA" }} />
                Table {tableName || "T-01"}
              </span>
            ) : (
              <span
                style={{
                  background: "#1F2937",
                  color: "#9CA3AF",
                  fontSize: "11px",
                  fontWeight: "800",
                  padding: "5px 12px",
                  borderRadius: "999px"
                }}
              >
                Online Takeaway Menu
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: "680px", margin: "0 auto", padding: "16px" }}>
        {/* Order Confirmation Banner */}
        {confirmedOrder && (
          <div
            style={{
              background: "#065F46",
              border: "1px solid #10B981",
              borderRadius: "10px",
              padding: "16px",
              marginBottom: "20px",
              textAlign: "center"
            }}
          >
            <strong style={{ display: "block", fontSize: "16px", color: "#FFF" }}>
              Order #{confirmedOrder} Placed Successfully!
            </strong>
            <p style={{ margin: "4px 0 10px 0", fontSize: "12px", color: "#A7F3D0" }}>
              {isDineIn ? "The kitchen received your ticket and is preparing your meal." : "Thank you for ordering with us!"}
            </p>
            {whatsAppLink && (
              <a
                href={whatsAppLink}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-block",
                  background: "#25D366",
                  color: "#FFF",
                  fontWeight: "800",
                  fontSize: "12px",
                  padding: "8px 18px",
                  borderRadius: "6px",
                  textDecoration: "none"
                }}
              >
                Open WhatsApp Chat
              </a>
            )}
          </div>
        )}

        {/* ── SPECIAL OFFERS SHOWCASE (A6) ── */}
        {activeSpecialOffers.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <span style={{ fontSize: "11px", color: "#DC2626", fontWeight: "800", letterSpacing: "1px", textTransform: "uppercase" }}>
              FEATURED PROMOTIONS
            </span>
            <div style={{ display: "grid", gap: "14px", marginTop: "8px" }}>
              {activeSpecialOffers.map((offer) => {
                const qty = cart[offer.item.id] || 0;
                return (
                  <div
                    key={offer.id}
                    style={{
                      background: "#181818",
                      border: "2px solid #DC2626",
                      borderRadius: "12px",
                      overflow: "hidden",
                      boxShadow: "0 8px 24px rgba(220, 38, 38, 0.2)",
                      display: "flex",
                      flexDirection: "row"
                    }}
                  >
                    {/* Offer Photo */}
                    <div style={{ width: "120px", minHeight: "120px", background: "#111", flexShrink: 0 }}>
                      {offer.item.image_url ? (
                        <img
                          src={offer.item.image_url}
                          alt={offer.item.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#555", fontSize: "11px" }}>
                          SPECIAL
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div style={{ padding: "14px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div>
                        <span
                          style={{
                            background: "#DC2626",
                            color: "#FFF",
                            fontSize: "9px",
                            fontWeight: "900",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            textTransform: "uppercase"
                          }}
                        >
                          {offer.badge_text || "PROMO DEAL"}
                        </span>
                        <strong style={{ display: "block", fontSize: "15px", color: "#FFF", marginTop: "4px" }}>
                          {offer.item.name}
                        </strong>
                        <p style={{ fontSize: "11px", color: "#8B949E", margin: "2px 0 8px 0" }}>
                          {offer.item.description || "Chef signature combo special"}
                        </p>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "15px", color: "#10B981", fontWeight: "800" }}>
                          Rs. {offer.item.price.toLocaleString()}
                        </span>

                        {qty === 0 ? (
                          <button
                            onClick={() => updateCart(offer.item.id, 1)}
                            style={{
                              background: "#DC2626",
                              color: "#FFF",
                              border: 0,
                              borderRadius: "6px",
                              padding: "6px 14px",
                              fontSize: "11px",
                              fontWeight: "800",
                              cursor: "pointer"
                            }}
                          >
                            + Add Deal
                          </button>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <button
                              onClick={() => updateCart(offer.item.id, -1)}
                              style={{ width: "28px", height: "28px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "4px", fontWeight: "800" }}
                            >
                              -
                            </button>
                            <span style={{ fontSize: "13px", fontWeight: "800", color: "#FFF" }}>{qty}</span>
                            <button
                              onClick={() => updateCart(offer.item.id, 1)}
                              style={{ width: "28px", height: "28px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "4px", fontWeight: "800" }}
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── CATEGORY TABS ── */}
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "10px", marginBottom: "16px" }}>
          <button
            onClick={() => setActiveCategory("")}
            style={{
              padding: "8px 14px",
              borderRadius: "20px",
              border: 0,
              background: activeCategory === "" ? "#DC2626" : "#1A1A1A",
              color: activeCategory === "" ? "#FFF" : "#8B949E",
              fontSize: "12px",
              fontWeight: "700",
              whiteSpace: "nowrap",
              cursor: "pointer"
            }}
          >
            All Items
          </button>
          {data?.categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={{
                padding: "8px 14px",
                borderRadius: "20px",
                border: 0,
                background: activeCategory === cat.id ? "#DC2626" : "#1A1A1A",
                color: activeCategory === cat.id ? "#FFF" : "#8B949E",
                fontSize: "12px",
                fontWeight: "700",
                whiteSpace: "nowrap",
                cursor: "pointer"
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* ── MENU ITEMS LIST (A7: CLEAN FALLBACK PHOTOS) ── */}
        <div style={{ display: "grid", gap: "12px" }}>
          {(data?.categories || [])
            .filter((cat) => !activeCategory || cat.id === activeCategory)
            .map((cat) => (
              <div key={cat.id}>
                <h3 style={{ fontSize: "14px", color: "#8B949E", margin: "16px 0 8px 0", fontWeight: "700" }}>
                  {cat.name.toUpperCase()}
                </h3>

                <div style={{ display: "grid", gap: "10px" }}>
                  {cat.menu_items.map((item) => {
                    const qty = cart[item.id] || 0;
                    return (
                      <div
                        key={item.id}
                        style={{
                          background: "#181818",
                          border: "1px solid #2A2A2A",
                          borderRadius: "10px",
                          padding: "12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px"
                        }}
                      >
                        {/* Photo with clean dark fallback (A7) */}
                        <div
                          style={{
                            width: "64px",
                            height: "64px",
                            borderRadius: "8px",
                            background: "#111",
                            overflow: "hidden",
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center"
                          }}
                        >
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.name}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <span style={{ fontSize: "10px", color: "#555", fontWeight: "700" }}>PHOTO</span>
                          )}
                        </div>

                        {/* Text */}
                        <div style={{ flex: 1 }}>
                          <strong style={{ fontSize: "14px", color: "#FFF" }}>{item.name}</strong>
                          {item.description && (
                            <p style={{ fontSize: "11px", color: "#8B949E", margin: "2px 0" }}>
                              {item.description}
                            </p>
                          )}
                          <span style={{ fontSize: "13px", color: "#10B981", fontWeight: "800", display: "block", marginTop: "2px" }}>
                            Rs. {item.price.toLocaleString()}
                          </span>
                        </div>

                        {/* Cart Action */}
                        <div>
                          {!item.in_stock ? (
                            <span style={{ fontSize: "10px", color: "#EF4444", fontWeight: "800", padding: "4px 8px", background: "#2A1818", borderRadius: "4px" }}>
                              SOLD OUT
                            </span>
                          ) : qty === 0 ? (
                            <button
                              onClick={() => updateCart(item.id, 1)}
                              style={{
                                background: "#DC2626",
                                color: "#FFF",
                                border: 0,
                                borderRadius: "6px",
                                padding: "6px 14px",
                                fontSize: "12px",
                                fontWeight: "800",
                                cursor: "pointer"
                              }}
                            >
                              + Add
                            </button>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <button
                                onClick={() => updateCart(item.id, -1)}
                                style={{ width: "28px", height: "28px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "4px", fontWeight: "800", cursor: "pointer" }}
                              >
                                -
                              </button>
                              <strong style={{ fontSize: "13px", color: "#FFF", minWidth: "16px", textAlign: "center" }}>{qty}</strong>
                              <button
                                onClick={() => updateCart(item.id, 1)}
                                style={{ width: "28px", height: "28px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "4px", fontWeight: "800", cursor: "pointer" }}
                              >
                                +
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>

        {/* Footer */}
        <footer style={{ marginTop: "40px", textAlign: "center", fontSize: "11px", color: "#666" }}>
          <span>Powered by RMS Platform · </span>
          <Link href="/privacy" style={{ color: "#888", textDecoration: "underline" }}>Privacy Policy</Link>
          <span> · </span>
          <Link href="/login" style={{ color: "#888", textDecoration: "underline" }}>Staff Login</Link>
        </footer>
      </main>

      {/* ── STICKY BOTTOM CART BAR ── */}
      {cartTotalQty > 0 && !cartDrawerOpen && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(19, 19, 19, 0.95)",
            backdropFilter: "blur(10px)",
            borderTop: "1px solid #333",
            padding: "12px 20px",
            zIndex: 50
          }}
        >
          <div style={{ maxWidth: "680px", margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontSize: "11px", color: "#8B949E" }}>{cartTotalQty} items selected</span>
              <strong style={{ display: "block", fontSize: "16px", color: "#10B981" }}>
                Rs. {cartTotalAmount.toLocaleString()}
              </strong>
            </div>

            <button
              onClick={() => setCartDrawerOpen(true)}
              style={{
                height: "42px",
                padding: "0 20px",
                background: "#DC2626",
                color: "#FFF",
                border: 0,
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "800",
                cursor: "pointer"
              }}
            >
              Review Cart &amp; Order →
            </button>
          </div>
        </div>
      )}

      {/* ── EXPANDABLE CART DRAWER (B2: DINE-IN vs DELIVERY / PICKUP) ── */}
      {cartDrawerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 100,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "680px",
              background: "#131313",
              borderTopLeftRadius: "16px",
              borderTopRightRadius: "16px",
              border: "1px solid #333",
              maxHeight: "85vh",
              overflowY: "auto",
              padding: "20px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF", fontWeight: "800" }}>Your Order Cart</h3>
              <button
                onClick={() => setCartDrawerOpen(false)}
                style={{ background: "transparent", border: 0, color: "#8B949E", fontSize: "18px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* Cart Items */}
            <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
              {Object.entries(cart).map(([id, qty]) => {
                const it = itemsById.get(id);
                if (!it) return null;
                return (
                  <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#1C1B1B", padding: "10px", borderRadius: "6px" }}>
                    <div>
                      <strong style={{ fontSize: "13px", color: "#FFF" }}>{it.name}</strong>
                      <span style={{ fontSize: "11px", color: "#10B981", display: "block" }}>
                        Rs. {(it.price * qty).toLocaleString()}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <button
                        onClick={() => updateCart(id, -1)}
                        style={{ width: "26px", height: "26px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "4px" }}
                      >
                        -
                      </button>
                      <strong style={{ fontSize: "13px", color: "#FFF" }}>{qty}</strong>
                      <button
                        onClick={() => updateCart(id, 1)}
                        style={{ width: "26px", height: "26px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "4px" }}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "15px", color: "#FFF", marginBottom: "16px", borderTop: "1px solid #333", paddingTop: "12px" }}>
              <strong>Total Bill:</strong>
              <strong style={{ color: "#10B981" }}>Rs. {cartTotalAmount.toLocaleString()}</strong>
            </div>

            {/* ── CHECKOUT FLOW ── */}
            {isDineIn ? (
              /* DINE-IN: Direct submit to kitchen */
              <div>
                <div style={{ background: "#1E3A8A", padding: "10px", borderRadius: "6px", marginBottom: "14px", fontSize: "12px", color: "#DBEAFE" }}>
                  <strong>Table {tableName || "T-01"} Dine-in Order</strong>
                  <span style={{ display: "block", fontSize: "11px" }}>This will send your order directly to the kitchen chefs.</span>
                </div>

                <button
                  disabled={sending}
                  onClick={submitDineInOrder}
                  style={{
                    width: "100%",
                    height: "44px",
                    background: "#DC2626",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: "800",
                    cursor: "pointer"
                  }}
                >
                  {sending ? "Sending Ticket..." : "Send Order to Kitchen"}
                </button>
              </div>
            ) : (
              /* TAKEAWAY: Choice between Delivery and Pickup (B2) */
              <form onSubmit={submitTakeawayOrder} style={{ display: "grid", gap: "12px" }}>
                {/* Delivery vs Pickup Selector (B2) */}
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "6px" }}>
                    CHOOSE ORDER TYPE:
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => setTakeawayChoice("delivery")}
                      style={{
                        height: "38px",
                        borderRadius: "6px",
                        border: 0,
                        background: takeawayChoice === "delivery" ? "#DC2626" : "#222736",
                        color: "#FFF",
                        fontWeight: "800",
                        fontSize: "12px",
                        cursor: "pointer"
                      }}
                    >
                      Door Delivery
                    </button>
                    <button
                      type="button"
                      onClick={() => setTakeawayChoice("pickup")}
                      style={{
                        height: "38px",
                        borderRadius: "6px",
                        border: 0,
                        background: takeawayChoice === "pickup" ? "#DC2626" : "#222736",
                        color: "#FFF",
                        fontWeight: "800",
                        fontSize: "12px",
                        cursor: "pointer"
                      }}
                    >
                      Self-Pickup
                    </button>
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "3px" }}>
                    YOUR NAME
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Ali Ahmed"
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "3px" }}>
                    MOBILE NUMBER (03XXXXXXXXX)
                  </label>
                  <input
                    type="tel"
                    placeholder="03001234567"
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                    style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                    required
                  />
                  {touched.phone && !isPhoneValid && (
                    <span style={{ color: "#EF4444", fontSize: "10px" }}>Enter 11 digits starting with 03.</span>
                  )}
                </div>

                {/* Address only shown if Delivery (B2) */}
                {takeawayChoice === "delivery" && (
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "3px" }}>
                      DELIVERY ADDRESS
                    </label>
                    <textarea
                      placeholder="Street, House #, Block, Landmark..."
                      value={customerForm.address}
                      onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
                      rows={2}
                      style={{ width: "100%", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "8px 10px", color: "#FFF", fontSize: "12px" }}
                      required
                    />
                  </div>
                )}

                <button
                  disabled={sending}
                  type="submit"
                  style={{
                    height: "44px",
                    background: "#25D366",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: "800",
                    cursor: "pointer",
                    marginTop: "6px"
                  }}
                >
                  {sending
                    ? "Placing Order..."
                    : takeawayChoice === "pickup"
                    ? "Confirm Pickup via WhatsApp"
                    : "Confirm Delivery via WhatsApp"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
