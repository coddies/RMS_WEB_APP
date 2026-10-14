"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type SpecialOffer = {
  id: string;
  menu_item_id: string;
  card_style: string | null;
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

type DeliveryForm = {
  name: string;
  phone: string;
  address: string;
  website: string;
};

function cloudinaryImageUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "res.cloudinary.com" ||
      !url.pathname.includes("/image/upload/")
    ) {
      return value;
    }
    url.pathname = url.pathname.replace(
      "/image/upload/",
      "/image/upload/f_auto,q_auto,w_600,h_600,c_fill/"
    );
    return url.toString();
  } catch {
    return value;
  }
}

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return "";
  return digits.startsWith("0") ? `92${digits.slice(1)}` : digits;
}

export default function Menu() {
  const [tenantSlug, setTenantSlug] = useState("demo");
  const [tableParam, setTableParam] = useState("");
  const [orderMode, setOrderMode] = useState<"dinein" | "delivery">("dinein");
  const [data, setData] = useState<MenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<string | null>(null);

  // Delivery Form State
  const [deliveryForm, setDeliveryForm] = useState<DeliveryForm>({
    name: "",
    phone: "",
    address: "",
    website: ""
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [whatsAppNotice, setWhatsAppNotice] = useState("");
  const [whatsAppLink, setWhatsAppLink] = useState("");

  // Parse query params on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tenant = params.get("tenant") || "demo";
    const table = params.get("table") || "";
    const type = params.get("type");

    setTenantSlug(tenant);
    setTableParam(table);

    if (type === "delivery") {
      setOrderMode("delivery");
    } else if (type === "dinein" || table) {
      setOrderMode("dinein");
    } else {
      setOrderMode("delivery");
    }
  }, []);

  // Fetch Menu Data
  useEffect(() => {
    let active = true;

    async function fetchMenu() {
      try {
        const query = new URLSearchParams({ tenant: tenantSlug });
        if (orderMode === "dinein" && tableParam) {
          query.set("table", tableParam);
        }

        const res = await fetch(`/api/menu?${query.toString()}`, { cache: "no-store" });
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error ?? "Unable to load restaurant menu.");
        }

        if (active) {
          setData(json);
          setError("");
          setLoading(false);

          // Clean cart of sold-out items
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
    const interval = window.setInterval(fetchMenu, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [tenantSlug, tableParam, orderMode]);

  // Flattened item lookups
  const allItems = data?.categories.flatMap((c) => c.menu_items) ?? [];
  const itemsById = new Map(allItems.map((i) => [i.id, i]));
  const specialOffersByItemId = new Map(
    (data?.special_offers ?? []).map((o) => [o.menu_item_id, o])
  );

  const cartCount = Object.values(cart).reduce((sum, n) => sum + n, 0);
  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = itemsById.get(id);
    return sum + (item ? item.price * qty : 0);
  }, 0);

  // Cart operations
  function addToCart(item: MenuItem) {
    if (!item.in_stock) return;
    setCart((prev) => ({
      ...prev,
      [item.id]: Math.min((prev[item.id] ?? 0) + 1, 99)
    }));
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const next = { ...prev };
      if (next[itemId] > 1) {
        next[itemId] -= 1;
      } else {
        delete next[itemId];
      }
      return next;
    });
  }

  function clearCart() {
    setCart({});
    setCartDrawerOpen(false);
  }

  // Delivery Form Validation (FR-13)
  const cleanPhone = deliveryForm.phone.replace(/[\s-]/g, "");
  const fieldErrors = {
    name:
      deliveryForm.name.trim().length < 2
        ? "Name must be at least 2 characters."
        : deliveryForm.name.trim().length > 120
        ? "Name must be 120 characters or fewer."
        : "",
    phone: /^03\d{9}$/.test(cleanPhone)
      ? ""
      : "Enter a valid Pakistani mobile number (03XXXXXXXXX format).",
    address:
      deliveryForm.address.trim().length < 10
        ? "Address must be at least 10 characters."
        : deliveryForm.address.trim().length > 500
        ? "Address must be 500 characters or fewer."
        : ""
  };
  const isDeliveryFormValid =
    !fieldErrors.name && !fieldErrors.phone && !fieldErrors.address && cartCount > 0;

  // Checkout Submissions
  async function submitDineInOrder() {
    setSending(true);
    setError("");
    try {
      const activeTable = data?.table?.table_number || tableParam || "T-01";
      const payload = {
        tenant_slug: tenantSlug,
        table_number: activeTable,
        order_type: "DINE_IN",
        items: Object.entries(cart).map(([item_id, quantity]) => ({
          item_id,
          quantity
        }))
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Failed to submit order.");

      setConfirmedOrder(String(result.order_number ?? result.sequence_no ?? "RECEIVED"));
      setCart({});
      setCartDrawerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit order.");
    } finally {
      setSending(false);
    }
  }

  async function submitDeliveryOrder(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, phone: true, address: true });
    setError("");
    setWhatsAppNotice("");

    if (!isDeliveryFormValid) return;

    // Honeypot check
    if (deliveryForm.website) return;

    const popup = window.open("about:blank", "_blank");
    setSending(true);

    try {
      const payload = {
        order_type: "DELIVERY",
        tenant_slug: tenantSlug,
        customer_name: deliveryForm.name.trim(),
        customer_phone: cleanPhone,
        customer_address: deliveryForm.address.trim(),
        website: deliveryForm.website,
        items: Object.entries(cart).map(([item_id, quantity]) => ({
          item_id,
          quantity
        }))
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Delivery order could not be placed.");

      setConfirmedOrder(String(result.order_number ?? "RECEIVED"));
      setCart({});
      setCartDrawerOpen(false);

      const restPhone = normalizeWhatsAppNumber(data?.tenant.whatsapp_phone);
      if (restPhone.length < 10) {
        popup?.close();
        setWhatsAppNotice(
          "Your order was saved, but the restaurant WhatsApp number is being configured. The staff will call you directly."
        );
        return;
      }

      const summary = [
        `Delivery Order #${result.order_number} — ${data?.tenant.brand_name ?? "Restaurant"}`,
        `Customer: ${deliveryForm.name.trim()}`,
        `Phone: ${cleanPhone}`,
        `Delivery Address: ${deliveryForm.address.trim()}`,
        "Items:",
        ...(result.items as { name: string; quantity: number; price: number }[]).map(
          (i) => `${i.quantity} × ${i.name} — Rs. ${Number(i.price).toLocaleString()}`
        ),
        `Total: Rs. ${Number(result.total_amount).toLocaleString()}`
      ].join("\n");

      const waUrl = `https://wa.me/${restPhone}?text=${encodeURIComponent(summary)}`;
      setWhatsAppLink(waUrl);

      if (popup) {
        popup.opener = null;
        popup.location.replace(waUrl);
      } else {
        setWhatsAppNotice("Order saved. Tap 'Open WhatsApp' below to forward your order details.");
      }
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : "Failed to place delivery order.");
    } finally {
      setSending(false);
    }
  }

  // Active Category Filter
  const categoriesToShow = (data?.categories ?? []).filter(
    (cat) => !activeCategory || cat.id === activeCategory
  );

  const displayTable = data?.table?.table_number || tableParam || "T-01";
  const tenantAccent = data?.tenant.primary_color || "#DC2626";

  if (loading) {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#0D0D0D",
          color: "#F0F0F0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, sans-serif"
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "42px",
              height: "42px",
              border: "3px solid #222736",
              borderTopColor: "#DC2626",
              borderRadius: "50%",
              margin: "0 auto 16px auto",
              animation: "spin 0.8s linear infinite"
            }}
          />
          <p style={{ color: "#8B949E", fontSize: "14px", fontWeight: "600" }}>
            Loading restaurant menu…
          </p>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </main>
    );
  }

  return (
    <main
      style={
        {
          minHeight: "100vh",
          background: "#0D0D0D",
          color: "#F0F0F0",
          fontFamily: "Inter, sans-serif",
          paddingBottom: cartCount > 0 ? "110px" : "40px",
          "--tenant-accent": tenantAccent
        } as React.CSSProperties
      }
    >
      {/* 1. HEADER (§2.1) */}
      <header
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          padding: "20px 16px 12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px"
        }}
      >
        <div>
          <span
            style={{
              color: "#DC2626",
              fontSize: "11px",
              fontWeight: "800",
              letterSpacing: "0.12em",
              textTransform: "uppercase"
            }}
          >
            ORDER ONLINE
          </span>
          <h1
            style={{
              margin: "2px 0 0 0",
              fontSize: "clamp(22px, 5vw, 28px)",
              fontWeight: "800",
              letterSpacing: "-0.03em",
              color: "#FFFFFF"
            }}
          >
            {data?.tenant.brand_name || "Restaurant Menu"}
          </h1>
        </div>

        {/* MODE BADGE (Table T-05 / Delivery) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "999px",
              background: orderMode === "dinein" ? "#161B22" : "#1B202B",
              border: `1px solid ${orderMode === "dinein" ? "#DC2626" : "#3B445B"}`,
              fontSize: "12px",
              fontWeight: "700",
              color: "#FFFFFF"
            }}
          >
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: orderMode === "dinein" ? "#10B981" : "#3B82F6"
              }}
            />
            {orderMode === "dinein" ? `Table ${displayTable}` : "Delivery"}
          </div>

          {/* Quick Mode Switcher */}
          <button
            onClick={() => setOrderMode(orderMode === "dinein" ? "delivery" : "dinein")}
            style={{
              height: "36px",
              padding: "0 10px",
              borderRadius: "6px",
              background: "transparent",
              border: "1px solid #2E3547",
              color: "#8B949E",
              fontSize: "11px",
              fontWeight: "600",
              cursor: "pointer"
            }}
          >
            Switch
          </button>
        </div>
      </header>

      {/* CONFIRMED ORDER BANNER */}
      {confirmedOrder && (
        <section
          style={{
            maxWidth: "800px",
            margin: "0 auto 16px auto",
            padding: "0 16px"
          }}
        >
          <div
            style={{
              background: "#14171F",
              border: "1px solid #10B981",
              borderRadius: "10px",
              padding: "16px 20px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ color: "#10B981", fontSize: "11px", fontWeight: "800", textTransform: "uppercase" }}>
                  ORDER SUBMITTED
                </span>
                <h3 style={{ margin: "2px 0 0 0", fontSize: "18px", color: "#FFFFFF" }}>
                  Order #{confirmedOrder} Sent to Kitchen!
                </h3>
                <p style={{ margin: "4px 0 0 0", color: "#8B949E", fontSize: "13px" }}>
                  {orderMode === "dinein"
                    ? `Your order for Table ${displayTable} is being prepared fresh.`
                    : "Your delivery order has been sent to the restaurant team."}
                </p>
              </div>
              <button
                onClick={() => setConfirmedOrder(null)}
                style={{
                  background: "#222736",
                  border: "0",
                  color: "#F0F0F0",
                  borderRadius: "6px",
                  padding: "8px 14px",
                  fontSize: "12px",
                  fontWeight: "700",
                  cursor: "pointer"
                }}
              >
                Order More
              </button>
            </div>
            {whatsAppNotice && (
              <p style={{ marginTop: "10px", color: "#FBBF24", fontSize: "13px" }}>
                {whatsAppNotice}{" "}
                {whatsAppLink && (
                  <a
                    href={whatsAppLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#34D399", fontWeight: "700", textDecoration: "underline" }}
                  >
                    Open WhatsApp
                  </a>
                )}
              </p>
            )}
          </div>
        </section>
      )}

      {/* 2. STICKY CATEGORY TABS (§2.1) */}
      <nav
        aria-label="Menu Categories"
        style={{
          position: "sticky",
          top: "0",
          zIndex: "10",
          background: "#0D0D0DF0",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid #222736",
          padding: "10px 16px"
        }}
      >
        <div
          style={{
            maxWidth: "800px",
            margin: "0 auto",
            display: "flex",
            gap: "8px",
            overflowX: "auto",
            scrollbarWidth: "none"
          }}
        >
          <button
            onClick={() => setActiveCategory("")}
            style={{
              flex: "none",
              minHeight: "44px",
              padding: "0 18px",
              borderRadius: "999px",
              border: !activeCategory ? "0" : "1px solid #252A36",
              background: !activeCategory ? "#DC2626" : "#161B22",
              color: !activeCategory ? "#FFFFFF" : "#8B949E",
              fontWeight: "700",
              fontSize: "13px",
              cursor: "pointer"
            }}
          >
            All Items
          </button>
          {(data?.categories ?? []).map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  flex: "none",
                  minHeight: "44px",
                  padding: "0 18px",
                  borderRadius: "999px",
                  border: isActive ? "0" : "1px solid #252A36",
                  background: isActive ? "#DC2626" : "#161B22",
                  color: isActive ? "#FFFFFF" : "#8B949E",
                  fontWeight: "700",
                  fontSize: "13px",
                  cursor: "pointer"
                }}
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      </nav>

      {/* 3. ITEM LIST (§2.1) */}
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          padding: "16px"
        }}
      >
        {categoriesToShow.map((cat) => (
          <section key={cat.id} style={{ marginBottom: "28px" }}>
            <h2
              style={{
                fontSize: "18px",
                fontWeight: "800",
                color: "#F0F0F0",
                margin: "0 0 14px 0",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              <span>{cat.name}</span>
              <span style={{ fontSize: "12px", color: "#8B949E", fontWeight: "600" }}>
                ({cat.menu_items.length})
              </span>
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
                gap: "14px"
              }}
            >
              {cat.menu_items.map((item) => {
                const photo = cloudinaryImageUrl(item.image_url);
                const countInCart = cart[item.id] ?? 0;
                const specialOffer = specialOffersByItemId.get(item.id);

                return (
                  <article
                    key={item.id}
                    style={{
                      display: "flex",
                      minHeight: "130px",
                      background: "#161B22",
                      border: specialOffer ? "1px solid #DC2626" : "1px solid #222736",
                      borderRadius: "12px",
                      overflow: "hidden",
                      position: "relative",
                      boxShadow: specialOffer
                        ? "0 4px 20px rgba(220, 38, 38, 0.2)"
                        : "0 4px 14px rgba(0,0,0,0.25)",
                      opacity: item.in_stock ? 1 : 0.6
                    }}
                  >
                    {/* Special Offer Badge (§2.4) */}
                    {specialOffer && (
                      <div
                        style={{
                          position: "absolute",
                          top: "0",
                          right: "0",
                          background: "#DC2626",
                          color: "#FFFFFF",
                          fontSize: "10px",
                          fontWeight: "800",
                          padding: "3px 8px",
                          borderBottomLeftRadius: "6px",
                          textTransform: "uppercase"
                        }}
                      >
                        {specialOffer.badge_text || "SPECIAL DEAL"}
                      </div>
                    )}

                    {/* Item Photo / Monogram */}
                    {photo ? (
                      <img
                        src={photo}
                        alt={item.name}
                        style={{
                          width: "115px",
                          minHeight: "130px",
                          objectFit: "cover",
                          background: "#1E232F"
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "115px",
                          minHeight: "130px",
                          background: "#1E232F",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "28px",
                          fontWeight: "800",
                          color: "#8B949E"
                        }}
                      >
                        {item.name.slice(0, 1)}
                      </div>
                    )}

                    {/* Item Info */}
                    <div
                      style={{
                        flex: 1,
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between"
                      }}
                    >
                      <div>
                        <h3
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: "15px",
                            fontWeight: "700",
                            color: "#FFFFFF"
                          }}
                        >
                          {item.name}
                        </h3>
                        {item.description && (
                          <p
                            style={{
                              margin: "0",
                              fontSize: "12px",
                              color: "#8B949E",
                              lineHeight: "1.4",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden"
                            }}
                          >
                            {item.description}
                          </p>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: "10px"
                        }}
                      >
                        <strong style={{ fontSize: "15px", color: "#FFFFFF", fontWeight: "800" }}>
                          Rs. {Number(item.price).toLocaleString()}
                        </strong>

                        {/* In Stock vs Sold Out */}
                        {item.in_stock ? (
                          countInCart > 0 ? (
                            /* Stepper */
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "8px",
                                background: "#0A0A0C",
                                borderRadius: "8px",
                                border: "1px solid #2E3547",
                                padding: "2px"
                              }}
                            >
                              <button
                                onClick={() => removeFromCart(item.id)}
                                style={{
                                  width: "34px",
                                  height: "34px",
                                  border: "0",
                                  borderRadius: "6px",
                                  background: "#1B202B",
                                  color: "#FFFFFF",
                                  fontSize: "16px",
                                  fontWeight: "800",
                                  cursor: "pointer"
                                }}
                              >
                                -
                              </button>
                              <span
                                style={{
                                  fontSize: "13px",
                                  fontWeight: "800",
                                  color: "#FFFFFF",
                                  minWidth: "16px",
                                  textAlign: "center"
                                }}
                              >
                                {countInCart}
                              </span>
                              <button
                                onClick={() => addToCart(item)}
                                style={{
                                  width: "34px",
                                  height: "34px",
                                  border: "0",
                                  borderRadius: "6px",
                                  background: "#DC2626",
                                  color: "#FFFFFF",
                                  fontSize: "16px",
                                  fontWeight: "800",
                                  cursor: "pointer"
                                }}
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            /* Single Add Button */
                            <button
                              onClick={() => addToCart(item)}
                              aria-label={`Add ${item.name}`}
                              style={{
                                width: "42px",
                                height: "42px",
                                border: "0",
                                borderRadius: "8px",
                                background: "#DC2626",
                                color: "#FFFFFF",
                                fontSize: "20px",
                                fontWeight: "800",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center"
                              }}
                            >
                              +
                            </button>
                          )
                        ) : (
                          <span
                            style={{
                              color: "#EF4444",
                              fontSize: "11px",
                              fontWeight: "700",
                              textTransform: "uppercase"
                            }}
                          >
                            Sold Out
                          </span>
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

      {/* 4. BOTTOM STICKY CART BAR (§2.1) */}
      {cartCount > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: "0",
            left: "0",
            right: "0",
            zIndex: "30",
            background: "#161B22F2",
            backdropFilter: "blur(14px)",
            borderTop: "1px solid #222736",
            padding: "14px 16px"
          }}
        >
          <div
            style={{
              maxWidth: "800px",
              margin: "0 auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px"
            }}
          >
            <div>
              <span style={{ fontSize: "12px", color: "#8B949E", display: "block" }}>
                {cartCount} item{cartCount > 1 ? "s" : ""} in cart
              </span>
              <strong style={{ fontSize: "18px", color: "#FFFFFF", fontWeight: "800" }}>
                Rs. {cartTotal.toLocaleString()}
              </strong>
            </div>

            <button
              onClick={() => setCartDrawerOpen(true)}
              style={{
                height: "48px",
                padding: "0 24px",
                borderRadius: "8px",
                border: "0",
                background: "#DC2626",
                color: "#FFFFFF",
                fontSize: "14px",
                fontWeight: "800",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px"
              }}
            >
              View Cart / Checkout
            </button>
          </div>
        </div>
      )}

      {/* 5. CHECKOUT DRAWER / MODAL (§2.1) */}
      {cartDrawerOpen && (
        <div
          style={{
            position: "fixed",
            inset: "0",
            zIndex: "40",
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "600px",
              maxHeight: "90vh",
              background: "#14171F",
              borderTopLeftRadius: "16px",
              borderTopRightRadius: "16px",
              border: "1px solid #222736",
              padding: "24px 20px",
              overflowY: "auto",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.5)"
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "18px"
              }}
            >
              <div>
                <span
                  style={{
                    color: "#DC2626",
                    fontSize: "11px",
                    fontWeight: "800",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase"
                  }}
                >
                  {orderMode === "dinein" ? "DINE-IN ORDER" : "DELIVERY ORDER"}
                </span>
                <h2 style={{ margin: "2px 0 0 0", fontSize: "20px", fontWeight: "800" }}>
                  Your Selected Items
                </h2>
              </div>
              <button
                onClick={() => setCartDrawerOpen(false)}
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  border: "1px solid #2E3547",
                  background: "#1B202B",
                  color: "#F0F0F0",
                  fontSize: "16px",
                  fontWeight: "bold",
                  cursor: "pointer"
                }}
              >
                x
              </button>
            </div>

            {/* Cart Items List */}
            <div style={{ borderBottom: "1px solid #222736", paddingBottom: "14px", marginBottom: "18px" }}>
              {Object.entries(cart).map(([id, qty]) => {
                const item = itemsById.get(id);
                if (!item) return null;
                return (
                  <div
                    key={id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 0"
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "14px", color: "#FFFFFF" }}>{item.name}</strong>
                      <span style={{ fontSize: "12px", color: "#8B949E", display: "block" }}>
                        Rs. {item.price.toLocaleString()} each
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "#0A0A0C",
                          borderRadius: "6px",
                          border: "1px solid #2E3547",
                          padding: "2px"
                        }}
                      >
                        <button
                          onClick={() => removeFromCart(id)}
                          style={{
                            width: "28px",
                            height: "28px",
                            border: "0",
                            background: "#1B202B",
                            color: "#FFFFFF",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "bold"
                          }}
                        >
                          -
                        </button>
                        <span style={{ minWidth: "16px", textAlign: "center", fontSize: "13px", fontWeight: "bold" }}>
                          {qty}
                        </span>
                        <button
                          onClick={() => addToCart(item)}
                          style={{
                            width: "28px",
                            height: "28px",
                            border: "0",
                            background: "#DC2626",
                            color: "#FFFFFF",
                            borderRadius: "4px",
                            cursor: "pointer",
                            fontWeight: "bold"
                          }}
                        >
                          +
                        </button>
                      </div>

                      <strong style={{ minWidth: "65px", textAlign: "right", fontSize: "14px", color: "#FFFFFF" }}>
                        Rs. {(item.price * qty).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                );
              })}

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: "14px",
                  paddingTop: "12px",
                  borderTop: "1px solid #222736"
                }}
              >
                <span style={{ fontSize: "15px", fontWeight: "700", color: "#8B949E" }}>Total Bill</span>
                <strong style={{ fontSize: "18px", fontWeight: "800", color: "#10B981" }}>
                  Rs. {cartTotal.toLocaleString()}
                </strong>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <p style={{ color: "#EF4444", fontSize: "13px", background: "#31191D", padding: "10px", borderRadius: "6px", margin: "0 0 16px 0" }}>
                {error}
              </p>
            )}

            {/* BRANCH 1: DINE-IN CHECKOUT (§2.1) */}
            {orderMode === "dinein" ? (
              <div>
                <div
                  style={{
                    background: "#0A0A0C",
                    border: "1px solid #222736",
                    borderRadius: "8px",
                    padding: "12px 14px",
                    marginBottom: "16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}
                >
                  <div>
                    <span style={{ fontSize: "11px", color: "#8B949E", display: "block" }}>DINE-IN LOCATION</span>
                    <strong style={{ fontSize: "14px", color: "#FFFFFF" }}>Table {displayTable}</strong>
                  </div>
                  <span style={{ color: "#10B981", fontSize: "12px", fontWeight: "700" }}>Verified Table QR</span>
                </div>

                <button
                  disabled={sending || cartCount === 0}
                  onClick={submitDineInOrder}
                  style={{
                    width: "100%",
                    minHeight: "50px",
                    background: "#DC2626",
                    color: "#FFFFFF",
                    border: "0",
                    borderRadius: "8px",
                    fontSize: "15px",
                    fontWeight: "800",
                    cursor: sending ? "wait" : "pointer",
                    opacity: sending ? 0.7 : 1
                  }}
                >
                  {sending ? "Sending Order to Kitchen…" : "Submit Order to Kitchen"}
                </button>
              </div>
            ) : (
              /* BRANCH 2: DELIVERY CHECKOUT (§2.1, FR-13) */
              <form onSubmit={submitDeliveryOrder} style={{ display: "grid", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#B7BEC9", fontWeight: "600", marginBottom: "4px" }}>
                    Your Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={deliveryForm.name}
                    onChange={(e) => setDeliveryForm({ ...deliveryForm, name: e.target.value })}
                    onBlur={() => setTouched({ ...touched, name: true })}
                    placeholder="e.g. Ali Ahmed"
                    style={{
                      width: "100%",
                      height: "44px",
                      padding: "0 12px",
                      borderRadius: "6px",
                      background: "#0A0A0C",
                      border: touched.name && fieldErrors.name ? "1px solid #EF4444" : "1px solid #2C3240",
                      color: "#FFFFFF",
                      fontSize: "14px"
                    }}
                  />
                  {touched.name && fieldErrors.name && (
                    <span style={{ color: "#EF4444", fontSize: "11px", marginTop: "2px", display: "block" }}>
                      {fieldErrors.name}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#B7BEC9", fontWeight: "600", marginBottom: "4px" }}>
                    Mobile Number (03XXXXXXXXX) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={deliveryForm.phone}
                    onChange={(e) => setDeliveryForm({ ...deliveryForm, phone: e.target.value })}
                    onBlur={() => setTouched({ ...touched, phone: true })}
                    placeholder="03001234567"
                    style={{
                      width: "100%",
                      height: "44px",
                      padding: "0 12px",
                      borderRadius: "6px",
                      background: "#0A0A0C",
                      border: touched.phone && fieldErrors.phone ? "1px solid #EF4444" : "1px solid #2C3240",
                      color: "#FFFFFF",
                      fontSize: "14px"
                    }}
                  />
                  {touched.phone && fieldErrors.phone && (
                    <span style={{ color: "#EF4444", fontSize: "11px", marginTop: "2px", display: "block" }}>
                      {fieldErrors.phone}
                    </span>
                  )}
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", color: "#B7BEC9", fontWeight: "600", marginBottom: "4px" }}>
                    Full Delivery Address *
                  </label>
                  <textarea
                    required
                    rows={2}
                    value={deliveryForm.address}
                    onChange={(e) => setDeliveryForm({ ...deliveryForm, address: e.target.value })}
                    onBlur={() => setTouched({ ...touched, address: true })}
                    placeholder="House/Apartment #, Street, Area/Sector, City"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "6px",
                      background: "#0A0A0C",
                      border: touched.address && fieldErrors.address ? "1px solid #EF4444" : "1px solid #2C3240",
                      color: "#FFFFFF",
                      fontSize: "14px",
                      resize: "vertical"
                    }}
                  />
                  {touched.address && fieldErrors.address && (
                    <span style={{ color: "#EF4444", fontSize: "11px", marginTop: "2px", display: "block" }}>
                      {fieldErrors.address}
                    </span>
                  )}
                </div>

                {/* Honeypot field (hidden from legitimate users) */}
                <input
                  type="text"
                  name="website"
                  value={deliveryForm.website}
                  onChange={(e) => setDeliveryForm({ ...deliveryForm, website: e.target.value })}
                  tabIndex={-1}
                  autoComplete="off"
                  style={{ position: "absolute", left: "-9999px" }}
                />

                <button
                  type="submit"
                  disabled={sending || cartCount === 0}
                  style={{
                    width: "100%",
                    minHeight: "50px",
                    background: "#DC2626",
                    color: "#FFFFFF",
                    border: "0",
                    borderRadius: "8px",
                    fontSize: "15px",
                    fontWeight: "800",
                    cursor: sending ? "wait" : "pointer",
                    marginTop: "8px"
                  }}
                >
                  {sending ? "Forwarding Order to WhatsApp…" : "Order via WhatsApp"}
                </button>
              </form>
            )}

            {/* Privacy Policy link always visible at checkout (§2.1, FR-15) */}
            <div style={{ marginTop: "16px", textAlign: "center" }}>
              <Link
                href="/privacy"
                style={{ color: "#8B949E", fontSize: "11px", textDecoration: "underline" }}
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 6. FOOTER (§2.1, FR-15) */}
      <footer
        style={{
          maxWidth: "800px",
          margin: "32px auto 0 auto",
          padding: "20px 16px",
          borderTop: "1px solid #222736",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          color: "#8B949E"
        }}
      >
        <span>
          {data?.tenant.brand_name || "Restaurant"} · Ignite POS
        </span>
        <div style={{ display: "flex", gap: "16px" }}>
          <Link href="/privacy" style={{ color: "#8B949E", textDecoration: "underline" }}>
            Privacy Policy
          </Link>
          <Link href="/login" style={{ color: "#8B949E", textDecoration: "underline" }}>
            Staff Sign In
          </Link>
        </div>
      </footer>
    </main>
  );
}
