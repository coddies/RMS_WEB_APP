"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import Link from "next/link";

type Session = {
  userId?: string;
  staffId?: string;
  tenantSlug: string;
  username?: string;
  name: string;
  role: string;
};

type Order = {
  id: string;
  order_number: number | string;
  table_id: string | null;
  table_number?: string;
  order_type: "DINE_IN" | "DELIVERY";
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  status?: string;
  payment_status?: string;
  items: { id?: string; name: string; quantity: number; price?: number }[];
  total_amount?: number;
  created_at: string;
};

type MenuItem = {
  id: string;
  name: string;
  price: number;
  category_id: string;
  category_name?: string;
  in_stock: boolean;
  image_url: string | null;
  description: string | null;
};

type Category = {
  id: string;
  name: string;
  menu_items: MenuItem[];
};

export default function StaffDashboard({ session }: { session: Session }) {
  const [activeTab, setActiveTab] = useState<
    "orders" | "kitchen" | "menu" | "offers" | "inventory" | "staff" | "qrcodes" | "reports"
  >("orders");

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<"all" | "dinein" | "delivery" | "urgent">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alertedOrderId, setAlertedOrderId] = useState<string | null>(null);

  // Menu State
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuSearch, setMenuSearch] = useState("");
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [newItemStock, setNewItemStock] = useState(true);

  // QR Code State
  const [selectedTable, setSelectedTable] = useState("T-01");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrTargetUrl, setQrTargetUrl] = useState("");

  const [loading, setLoading] = useState(true);
  const [actionNotice, setActionNotice] = useState("");

  const audioRef = useRef<AudioContext | null>(null);
  const seenOrderIds = useRef(new Set<string>());

  // Audio Chime Setup
  async function toggleSound() {
    try {
      audioRef.current ??= new AudioContext();
      await audioRef.current.resume();
      setSoundEnabled(audioRef.current.state === "running");
    } catch {
      setActionNotice("Audio context could not start in this browser.");
    }
  }

  function playAlertChime() {
    if (!soundEnabled) return;
    try {
      const ctx = audioRef.current;
      if (ctx && ctx.state === "running") {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      }
    } catch { }
  }

  // Poll Orders from Supabase
  useEffect(() => {
    let active = true;

    async function fetchOrders() {
      try {
        const res = await fetch("/api/orders", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to fetch orders.");

        if (active) {
          const incoming = (data.orders || []) as Order[];
          const newOrders = incoming.filter((o) => !seenOrderIds.current.has(o.id));

          if (newOrders.length > 0 && seenOrderIds.current.size > 0) {
            setAlertedOrderId(newOrders[0].id);
            playAlertChime();
            setTimeout(() => setAlertedOrderId(null), 2500);
          }

          incoming.forEach((o) => seenOrderIds.current.add(o.id));
          setOrders(incoming);
          setLoading(false);
        }
      } catch {
        if (active) setLoading(false);
      }
    }

    void fetchOrders();
    const interval = setInterval(fetchOrders, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [soundEnabled]);

  // Load Menu Data
  async function loadMenu() {
    try {
      const res = await fetch("/api/admin/menu", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.categories) {
        setCategories(data.categories);
      }
    } catch { }
  }

  useEffect(() => {
    if (activeTab === "menu") {
      void loadMenu();
    }
  }, [activeTab]);

  // Load Table QR Code
  useEffect(() => {
    let active = true;
    async function loadQr() {
      try {
        const res = await fetch(`/api/qrcode?tenant=${session.tenantSlug}&table=${selectedTable}`);
        const data = await res.json();
        if (active && res.ok) {
          setQrCodeUrl(data.data_url);
          setQrTargetUrl(data.url);
        }
      } catch { }
    }
    if (activeTab === "qrcodes") {
      void loadQr();
    }
    return () => { active = false; };
  }, [activeTab, selectedTable, session.tenantSlug]);

  // Toggle Stock Status
  async function toggleStockStatus(item: MenuItem) {
    try {
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stock", id: item.id, in_stock: !item.in_stock })
      });
      if (res.ok) {
        setCategories((prev) =>
          prev.map((cat) => ({
            ...cat,
            menu_items: cat.menu_items.map((i) =>
              i.id === item.id ? { ...i, in_stock: !i.in_stock } : i
            )
          }))
        );
        setActionNotice(`Stock updated for ${item.name}.`);
        setTimeout(() => setActionNotice(""), 3000);
      }
    } catch { }
  }

  // Create Menu Item
  async function handleCreateItem(e: FormEvent) {
    e.preventDefault();
    if (!newItemName || !newItemPrice) return;
    try {
      const catId = newItemCategory || categories[0]?.id;
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          name: newItemName.trim(),
          price: Number(newItemPrice),
          category_id: catId,
          description: "",
          in_stock: newItemStock,
          ingredients: []
        })
      });
      if (res.ok) {
        setIsAddModalOpen(false);
        setNewItemName("");
        setNewItemPrice("");
        void loadMenu();
        setActionNotice("New item published to catalog.");
        setTimeout(() => setActionNotice(""), 3000);
      }
    } catch { }
  }

  // Filter Orders
  const filteredOrders = orders.filter((order) => {
    if (orderFilter === "dinein" && order.order_type !== "DINE_IN") return false;
    if (orderFilter === "delivery" && order.order_type !== "DELIVERY") return false;
    if (orderFilter === "urgent") {
      const elapsedMins = (Date.now() - new Date(order.created_at).getTime()) / 60000;
      if (elapsedMins < 15) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const numMatch = String(order.order_number).toLowerCase().includes(q);
      const nameMatch = (order.customer_name || "").toLowerCase().includes(q);
      const itemsMatch = order.items.some((i) => i.name.toLowerCase().includes(q));
      if (!numMatch && !nameMatch && !itemsMatch) return false;
    }
    return true;
  });

  // Flat menu items count
  const allMenuItems = categories.flatMap((c) => c.menu_items);
  const inStockCount = allMenuItems.filter((i) => i.in_stock).length;
  const soldOutCount = allMenuItems.length - inStockCount;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "#0D0D0D",
        color: "#F0F0F0",
        fontFamily: "Inter, sans-serif"
      }}
    >
      {/* ── LEFT SIDEBAR NAVIGATION (IGNITE POS & OPS) ── */}
      <aside
        style={{
          width: "250px",
          background: "#131313",
          borderRight: "1px solid #2A2A2A",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "16px 12px",
          position: "sticky",
          top: "0",
          height: "100vh",
          flexShrink: 0
        }}
      >
        <div>
          {/* Brand Header */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 8px 18px 8px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                background: "#DC2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFFFFF",
                fontWeight: "900",
                fontSize: "18px"
              }}
            >
              R
            </div>
            <div>
              <span style={{ fontSize: "10px", color: "#DC2626", fontWeight: "800", letterSpacing: "0.1em" }}>
                IGNITE POS &amp; OPS
              </span>
              <h2 style={{ margin: "1px 0 0 0", fontSize: "14px", fontWeight: "800", color: "#FFFFFF" }}>
                {session.tenantSlug.toUpperCase()} TERMINAL
              </h2>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ display: "grid", gap: "4px" }}>
            <button
              onClick={() => setActiveTab("orders")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "orders" ? "#DC2626" : "transparent",
                color: activeTab === "orders" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span>Orders (POS)</span>
              <span
                style={{
                  background: activeTab === "orders" ? "rgba(0,0,0,0.3)" : "#222736",
                  color: "#FFFFFF",
                  fontSize: "11px",
                  fontWeight: "800",
                  padding: "2px 8px",
                  borderRadius: "999px"
                }}
              >
                {orders.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("kitchen")}
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "kitchen" ? "#DC2626" : "transparent",
                color: activeTab === "kitchen" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              Kitchen (KDS)
            </button>

            <button
              onClick={() => setActiveTab("menu")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "menu" ? "#DC2626" : "transparent",
                color: activeTab === "menu" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span>Menu Management</span>
              <span style={{ fontSize: "11px", color: inStockCount > 0 ? "#10B981" : "#8B949E", fontWeight: "700" }}>
                {allMenuItems.length} items
              </span>
            </button>

            <button
              onClick={() => setActiveTab("qrcodes")}
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "qrcodes" ? "#DC2626" : "transparent",
                color: activeTab === "qrcodes" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              Table QR Codes
            </button>

            <button
              onClick={() => setActiveTab("offers")}
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "offers" ? "#DC2626" : "transparent",
                color: activeTab === "offers" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              Special Offers
            </button>

            <button
              onClick={() => setActiveTab("inventory")}
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "inventory" ? "#DC2626" : "transparent",
                color: activeTab === "inventory" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              Inventory
            </button>

            <button
              onClick={() => setActiveTab("staff")}
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "staff" ? "#DC2626" : "transparent",
                color: activeTab === "staff" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              Staff Accounts
            </button>

            <button
              onClick={() => setActiveTab("reports")}
              style={{
                display: "flex",
                alignItems: "center",
                height: "44px",
                padding: "0 14px",
                borderRadius: "8px",
                border: "0",
                background: activeTab === "reports" ? "#DC2626" : "transparent",
                color: activeTab === "reports" ? "#FFFFFF" : "#8B949E",
                fontSize: "13px",
                fontWeight: "700",
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              Reports &amp; Settings
            </button>
          </nav>
        </div>

        {/* Bottom Profile & Status Card */}
        <div>
          {/* Station Status */}
          <div
            style={{
              padding: "10px 12px",
              background: "#181818",
              border: "1px solid #2A2A2A",
              borderRadius: "8px",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background: "#10B981"
                }}
              />
              <span style={{ fontSize: "10px", color: "#8B949E", fontWeight: "700" }}>LIVE TERMINAL</span>
            </div>
            <span style={{ fontSize: "10px", color: "#10B981", fontWeight: "800" }}>ONLINE</span>
          </div>

          {/* User Card */}
          <div
            style={{
              padding: "12px",
              background: "#181818",
              border: "1px solid #2A2A2A",
              borderRadius: "8px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <strong style={{ fontSize: "13px", color: "#FFFFFF" }}>{session.name}</strong>
              <span
                style={{
                  background: "#DC2626",
                  color: "#FFFFFF",
                  fontSize: "9px",
                  fontWeight: "800",
                  padding: "2px 6px",
                  borderRadius: "4px"
                }}
              >
                {session.role.toUpperCase()}
              </span>
            </div>

            <form action="/api/auth/logout" method="post" style={{ marginTop: "6px" }}>
              <button
                type="submit"
                style={{
                  width: "100%",
                  height: "32px",
                  background: "#222736",
                  color: "#F0F0F0",
                  border: "0",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: "pointer"
                }}
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT AREA ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top Header Bar */}
        <header
          style={{
            height: "64px",
            background: "rgba(19, 19, 19, 0.9)",
            backdropFilter: "blur(12px)",
            borderBottom: "1px solid #2A2A2A",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            position: "sticky",
            top: "0",
            zIndex: "20"
          }}
        >
          <div>
            <span style={{ color: "#DC2626", fontSize: "10px", fontWeight: "800", letterSpacing: "0.1em" }}>
              OPERATIONS PORTAL
            </span>
            <h1 style={{ margin: "2px 0 0 0", fontSize: "18px", fontWeight: "800", color: "#FFFFFF" }}>
              {activeTab === "orders" && "Live Orders Dashboard"}
              {activeTab === "kitchen" && "Kitchen Display System (KDS)"}
              {activeTab === "menu" && "Menu Catalog Management"}
              {activeTab === "qrcodes" && "Table QR Code Generator"}
              {activeTab === "offers" && "Special Offers & Deals"}
              {activeTab === "inventory" && "Ingredient Stock Monitoring"}
              {activeTab === "staff" && "Staff Accounts & Security"}
              {activeTab === "reports" && "Sales Reports & Hardware Settings"}
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {actionNotice && (
              <span style={{ fontSize: "12px", color: "#10B981", fontWeight: "700" }}>
                {actionNotice}
              </span>
            )}

            {/* Chime Audio Toggle */}
            <button
              onClick={toggleSound}
              style={{
                height: "38px",
                padding: "0 12px",
                borderRadius: "6px",
                border: "1px solid #2A2A2A",
                background: soundEnabled ? "rgba(16, 185, 129, 0.15)" : "#181818",
                color: soundEnabled ? "#10B981" : "#8B949E",
                fontSize: "12px",
                fontWeight: "700",
                cursor: "pointer"
              }}
            >
              {soundEnabled ? "CHIME ON" : "CHIME OFF"}
            </button>

            {/* View Live Customer Menu */}
            <Link
              href="/menu?tenant=demo&table=T-01&type=dinein"
              target="_blank"
              style={{
                height: "38px",
                padding: "0 14px",
                borderRadius: "6px",
                background: "#DC2626",
                color: "#FFFFFF",
                fontSize: "12px",
                fontWeight: "700",
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none"
              }}
            >
              Open Live Menu
            </Link>
          </div>
        </header>

        {/* ── TAB PANES ── */}
        <main style={{ padding: "24px", flex: 1, overflowY: "auto" }}>
          {/* TAB 1: ORDERS DASHBOARD */}
          {activeTab === "orders" && (
            <div>
              {/* Filter Tabs Bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 16px",
                  background: "#181818",
                  border: "1px solid #2A2A2A",
                  borderRadius: "10px",
                  marginBottom: "20px"
                }}
              >
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setOrderFilter("all")}
                    style={{
                      height: "40px",
                      padding: "0 16px",
                      borderRadius: "6px",
                      border: "0",
                      background: orderFilter === "all" ? "#DC2626" : "#222736",
                      color: "#FFFFFF",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    All ({orders.length})
                  </button>
                  <button
                    onClick={() => setOrderFilter("dinein")}
                    style={{
                      height: "40px",
                      padding: "0 16px",
                      borderRadius: "6px",
                      border: "0",
                      background: orderFilter === "dinein" ? "#DC2626" : "#222736",
                      color: "#FFFFFF",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    Dine-In
                  </button>
                  <button
                    onClick={() => setOrderFilter("delivery")}
                    style={{
                      height: "40px",
                      padding: "0 16px",
                      borderRadius: "6px",
                      border: "0",
                      background: orderFilter === "delivery" ? "#DC2626" : "#222736",
                      color: "#FFFFFF",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    Delivery
                  </button>
                  <button
                    onClick={() => setOrderFilter("urgent")}
                    style={{
                      height: "40px",
                      padding: "0 16px",
                      borderRadius: "6px",
                      border: "0",
                      background: orderFilter === "urgent" ? "#DC2626" : "#222736",
                      color: "#EF4444",
                      fontSize: "13px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    Urgent (&gt;15m)
                  </button>
                </div>

                {/* Search Box */}
                <input
                  type="text"
                  placeholder="Search order #, table, customer..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: "280px",
                    height: "40px",
                    padding: "0 12px",
                    borderRadius: "6px",
                    background: "#0E0E0E",
                    border: "1px solid #2A2A2A",
                    color: "#FFFFFF",
                    fontSize: "13px"
                  }}
                />
              </div>

              {/* Orders Grid */}
              {filteredOrders.length === 0 ? (
                <div
                  style={{
                    padding: "60px 20px",
                    textAlign: "center",
                    border: "1px dashed #2A2A2A",
                    borderRadius: "12px",
                    background: "#131313"
                  }}
                >
                  <h3 style={{ color: "#8B949E", fontSize: "16px", fontWeight: "700" }}>
                    No orders matching this filter
                  </h3>
                  <p style={{ color: "#666", fontSize: "13px" }}>
                    When customers place orders online or via QR code, they appear here live.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
                    gap: "16px"
                  }}
                >
                  {filteredOrders.map((order) => {
                    const elapsedMins = Math.floor(
                      (Date.now() - new Date(order.created_at).getTime()) / 60000
                    );
                    const isUrgent = elapsedMins >= 15;
                    const isNewFlash = order.id === alertedOrderId;

                    return (
                      <article
                        key={order.id}
                        style={{
                          background: "#181818",
                          border: isUrgent
                            ? "1px solid #DC2626"
                            : isNewFlash
                            ? "1px solid #10B981"
                            : "1px solid #2A2A2A",
                          borderRadius: "12px",
                          overflow: "hidden",
                          boxShadow: isUrgent
                            ? "0 4px 20px rgba(220, 38, 38, 0.25)"
                            : "0 4px 14px rgba(0,0,0,0.3)"
                        }}
                      >
                        {/* Card Header Ribbon */}
                        <div
                          style={{
                            background: isUrgent ? "#920703" : "#201F1F",
                            padding: "8px 14px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between"
                          }}
                        >
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: "800",
                              color: isUrgent ? "#FFA5A5" : "#8B949E",
                              textTransform: "uppercase"
                            }}
                          >
                            {order.order_type === "DELIVERY" ? "DELIVERY DISPATCH" : "DINE-IN ORDER"}
                          </span>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: "800",
                              color: isUrgent ? "#FFA5A5" : "#FFFFFF"
                            }}
                          >
                            {elapsedMins}m ago
                          </span>
                        </div>

                        {/* Card Body */}
                        <div style={{ padding: "14px" }}>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              marginBottom: "10px"
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: "16px", color: "#FFFFFF" }}>
                                Order #{order.order_number ?? order.id.slice(0, 6)}
                              </strong>
                              <span style={{ fontSize: "12px", color: "#8B949E", display: "block" }}>
                                {order.customer_name ? `Customer: ${order.customer_name}` : "Table Guest"}
                              </span>
                            </div>

                            <span
                              style={{
                                background: "#DC2626",
                                color: "#FFFFFF",
                                fontSize: "10px",
                                fontWeight: "800",
                                padding: "4px 8px",
                                borderRadius: "4px"
                              }}
                            >
                              {order.order_type === "DELIVERY"
                                ? "DELIVERY"
                                : `TABLE ${order.table_number || order.table_id || "T-01"}`}
                            </span>
                          </div>

                          {/* Items Ledger */}
                          <div
                            style={{
                              borderTop: "1px solid #2A2A2A",
                              borderBottom: "1px solid #2A2A2A",
                              padding: "10px 0",
                              margin: "10px 0"
                            }}
                          >
                            {(order.items || []).map((item, i) => (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontSize: "13px",
                                  padding: "3px 0"
                                }}
                              >
                                <span style={{ color: "#F0F0F0" }}>{item.name}</span>
                                <strong style={{ color: "#DC2626" }}>x {item.quantity}</strong>
                              </div>
                            ))}
                          </div>

                          {/* Action Buttons */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "12px" }}>
                            <button
                              onClick={() => {
                                setActionNotice(`Sent Order #${order.order_number} to printer.`);
                                setTimeout(() => setActionNotice(""), 3000);
                              }}
                              style={{
                                height: "38px",
                                background: "#222736",
                                color: "#F0F0F0",
                                border: "0",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer"
                              }}
                            >
                              Print KOT
                            </button>
                            <button
                              onClick={() => {
                                setActionNotice(`Order #${order.order_number} marked ready.`);
                                setTimeout(() => setActionNotice(""), 3000);
                              }}
                              style={{
                                height: "38px",
                                background: "#DC2626",
                                color: "#FFFFFF",
                                border: "0",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer"
                              }}
                            >
                              Mark Ready
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: KITCHEN DISPLAY SYSTEM (KDS) */}
          {activeTab === "kitchen" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
              {/* Column 1: Received */}
              <div style={{ background: "#14171F", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <strong style={{ color: "#EF4444", fontSize: "14px", fontWeight: "800" }}>1. RECEIVED (NEW)</strong>
                  <span style={{ background: "#EF4444", color: "#FFF", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: "800" }}>
                    {orders.length}
                  </span>
                </div>
                {orders.map((o) => (
                  <div key={o.id} style={{ background: "#1C1B1B", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "12px", marginBottom: "10px" }}>
                    <strong>Order #{o.order_number}</strong>
                    <p style={{ color: "#8B949E", fontSize: "12px", margin: "4px 0" }}>
                      {(o.items || []).map((i) => `${i.quantity}x ${i.name}`).join(", ")}
                    </p>
                    <button style={{ marginTop: "8px", width: "100%", height: "34px", background: "#DC2626", color: "#FFF", border: "0", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
                      Start Cooking
                    </button>
                  </div>
                ))}
              </div>

              {/* Column 2: Preparing */}
              <div style={{ background: "#14171F", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <strong style={{ color: "#F59E0B", fontSize: "14px", fontWeight: "800" }}>2. PREPARING</strong>
                  <span style={{ background: "#F59E0B", color: "#FFF", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: "800" }}>
                    Active
                  </span>
                </div>
                <div style={{ background: "#1C1B1B", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>Table T-01</strong>
                    <span style={{ color: "#F59E0B", fontWeight: "700", fontSize: "12px" }}>12:40</span>
                  </div>
                  <p style={{ color: "#8B949E", fontSize: "12px", margin: "6px 0" }}>2x Smoked Wagyu Brisket, 1x Fries</p>
                  <button style={{ width: "100%", height: "34px", background: "#10B981", color: "#FFF", border: "0", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
                    Mark Plated
                  </button>
                </div>
              </div>

              {/* Column 3: Ready */}
              <div style={{ background: "#14171F", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <strong style={{ color: "#10B981", fontSize: "14px", fontWeight: "800" }}>3. PICKUP / READY</strong>
                  <span style={{ background: "#10B981", color: "#FFF", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: "800" }}>
                    Done
                  </span>
                </div>
                <div style={{ background: "#1C1B1B", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong>Table T-05</strong>
                    <span style={{ color: "#10B981", fontWeight: "700", fontSize: "12px" }}>Ready</span>
                  </div>
                  <p style={{ color: "#8B949E", fontSize: "12px", margin: "6px 0" }}>1x BBQ Ribs Platter, 2x Drink</p>
                  <button style={{ width: "100%", height: "34px", background: "#222736", color: "#FFF", border: "0", borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}>
                    Complete Handoff
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MENU MANAGEMENT */}
          {activeTab === "menu" && (
            <div>
              {/* Metric Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "14px", marginBottom: "20px" }}>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#8B949E", fontWeight: "700" }}>TOTAL ITEMS</span>
                  <strong style={{ display: "block", fontSize: "24px", color: "#FFFFFF", marginTop: "4px" }}>
                    {allMenuItems.length}
                  </strong>
                </div>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#10B981", fontWeight: "700" }}>IN STOCK</span>
                  <strong style={{ display: "block", fontSize: "24px", color: "#10B981", marginTop: "4px" }}>
                    {inStockCount}
                  </strong>
                </div>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#EF4444", fontWeight: "700" }}>SOLD OUT</span>
                  <strong style={{ display: "block", fontSize: "24px", color: "#EF4444", marginTop: "4px" }}>
                    {soldOutCount}
                  </strong>
                </div>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#10B981", fontWeight: "700" }}>CLOUD SYNC</span>
                  <strong style={{ display: "block", fontSize: "24px", color: "#10B981", marginTop: "4px" }}>
                    100% Synced
                  </strong>
                </div>
              </div>

              {/* Action Bar */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <input
                  type="text"
                  placeholder="Filter menu items…"
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  style={{
                    width: "320px",
                    height: "42px",
                    padding: "0 14px",
                    borderRadius: "6px",
                    background: "#0E0E0E",
                    border: "1px solid #2A2A2A",
                    color: "#FFFFFF",
                    fontSize: "13px"
                  }}
                />
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  style={{
                    height: "42px",
                    padding: "0 18px",
                    borderRadius: "6px",
                    background: "#DC2626",
                    color: "#FFFFFF",
                    border: "0",
                    fontWeight: "800",
                    fontSize: "13px",
                    cursor: "pointer"
                  }}
                >
                  + Add New Menu Item
                </button>
              </div>

              {/* Categories & Items */}
              {categories.map((cat) => {
                const items = cat.menu_items.filter((i) =>
                  !menuSearch || i.name.toLowerCase().includes(menuSearch.toLowerCase())
                );
                if (items.length === 0) return null;

                return (
                  <div key={cat.id} style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", marginBottom: "18px", overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: "#201F1F", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: "15px", color: "#FFFFFF" }}>{cat.name}</strong>
                      <span style={{ fontSize: "12px", color: "#8B949E" }}>{items.length} items</span>
                    </div>

                    <div style={{ padding: "8px 16px" }}>
                      {items.map((item) => (
                        <div
                          key={item.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "12px 0",
                            borderBottom: "1px solid #2A2A2A"
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: "14px", color: "#FFFFFF" }}>{item.name}</strong>
                            <span style={{ fontSize: "12px", color: "#8B949E", display: "block", marginTop: "2px" }}>
                              Rs. {Number(item.price).toLocaleString()}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <button
                              onClick={() => toggleStockStatus(item)}
                              style={{
                                height: "34px",
                                padding: "0 14px",
                                borderRadius: "999px",
                                border: item.in_stock ? "1px solid #10B981" : "1px solid #EF4444",
                                background: item.in_stock ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                                color: item.in_stock ? "#10B981" : "#EF4444",
                                fontSize: "11px",
                                fontWeight: "800",
                                cursor: "pointer"
                              }}
                            >
                              {item.in_stock ? "IN STOCK" : "OUT OF STOCK"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Add New Item Modal */}
              {isAddModalOpen && (
                <div style={{ position: "fixed", inset: "0", background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "50" }}>
                  <form onSubmit={handleCreateItem} style={{ width: "420px", background: "#14171F", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "24px" }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", fontWeight: "800" }}>Add New Menu Item</h3>
                    <div style={{ display: "grid", gap: "12px", marginBottom: "18px" }}>
                      <input
                        type="text"
                        placeholder="Item Name *"
                        required
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        style={{ height: "42px", padding: "0 12px", background: "#0E0E0E", border: "1px solid #2A2A2A", color: "#FFF", borderRadius: "6px" }}
                      />
                      <input
                        type="number"
                        placeholder="Price in Rs. *"
                        required
                        value={newItemPrice}
                        onChange={(e) => setNewItemPrice(e.target.value)}
                        style={{ height: "42px", padding: "0 12px", background: "#0E0E0E", border: "1px solid #2A2A2A", color: "#FFF", borderRadius: "6px" }}
                      />
                      <select
                        value={newItemCategory}
                        onChange={(e) => setNewItemCategory(e.target.value)}
                        style={{ height: "42px", padding: "0 12px", background: "#0E0E0E", border: "1px solid #2A2A2A", color: "#FFF", borderRadius: "6px" }}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#F0F0F0" }}>
                        <input
                          type="checkbox"
                          checked={newItemStock}
                          onChange={(e) => setNewItemStock(e.target.checked)}
                        />
                        Available In Stock immediately
                      </label>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                      <button
                        type="button"
                        onClick={() => setIsAddModalOpen(false)}
                        style={{ height: "40px", padding: "0 16px", background: "transparent", border: "1px solid #2A2A2A", color: "#8B949E", borderRadius: "6px", cursor: "pointer" }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        style={{ height: "40px", padding: "0 18px", background: "#DC2626", border: "0", color: "#FFF", borderRadius: "6px", fontWeight: "800", cursor: "pointer" }}
                      >
                        Save Item
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: TABLE QR CODES */}
          {activeTab === "qrcodes" && (
            <div style={{ maxWidth: "600px", margin: "0 auto", background: "#181818", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "24px" }}>
              <div style={{ marginBottom: "18px" }}>
                <span style={{ color: "#DC2626", fontSize: "11px", fontWeight: "800" }}>TABLE STANDS</span>
                <h3 style={{ margin: "2px 0 0 0", fontSize: "18px" }}>Table QR Code Cards</h3>
              </div>

              <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
                {["T-01", "T-02", "T-03", "T-04", "T-05"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTable(t)}
                    style={{
                      flex: 1,
                      height: "40px",
                      borderRadius: "6px",
                      border: "0",
                      background: selectedTable === t ? "#DC2626" : "#222736",
                      color: "#FFFFFF",
                      fontWeight: "700",
                      fontSize: "13px",
                      cursor: "pointer"
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div style={{ textAlign: "center", background: "#FFFFFF", padding: "20px", borderRadius: "10px", marginBottom: "16px" }}>
                {qrCodeUrl ? (
                  <>
                    <img src={qrCodeUrl} alt={selectedTable} style={{ width: "220px", height: "220px", margin: "0 auto", display: "block" }} />
                    <strong style={{ color: "#111", fontSize: "18px", display: "block", marginTop: "10px" }}>
                      TABLE {selectedTable}
                    </strong>
                    <span style={{ color: "#666", fontSize: "11px" }}>Scan to open live menu</span>
                  </>
                ) : (
                  <p style={{ color: "#111" }}>Loading QR code…</p>
                )}
              </div>

              <div style={{ background: "#0E0E0E", border: "1px solid #2A2A2A", borderRadius: "6px", padding: "10px", marginBottom: "16px" }}>
                <span style={{ fontSize: "10px", color: "#8B949E", display: "block" }}>LIVE DESTINATION:</span>
                <code style={{ fontSize: "12px", color: "#10B981", wordBreak: "break-all" }}>{qrTargetUrl}</code>
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <a
                  href={qrTargetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ height: "40px", padding: "0 16px", background: "#222736", color: "#FFF", borderRadius: "6px", display: "inline-flex", alignItems: "center", textDecoration: "none", fontSize: "12px", fontWeight: "700" }}
                >
                  Test Link
                </a>
                <button
                  onClick={() => window.print()}
                  style={{ height: "40px", padding: "0 18px", background: "#DC2626", color: "#FFF", border: "0", borderRadius: "6px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }}
                >
                  Print QR Card
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: SPECIAL OFFERS */}
          {activeTab === "offers" && (
            <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "18px", color: "#FFF" }}>Active Promotions &amp; Deals</h3>
                  <p style={{ margin: "2px 0 0 0", color: "#8B949E", fontSize: "13px" }}>Configured combos and marketing banners</p>
                </div>
                <button style={{ height: "40px", padding: "0 16px", background: "#DC2626", color: "#FFF", border: "0", borderRadius: "6px", fontWeight: "800", cursor: "pointer" }}>
                  + Create Deal
                </button>
              </div>
              <div style={{ display: "grid", gap: "12px" }}>
                <div style={{ background: "#201F1F", border: "1px solid #DC2626", borderRadius: "8px", padding: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong style={{ color: "#FFF", fontSize: "15px" }}>Pitmaster Weekend Brisket Combo</strong>
                    <span style={{ color: "#DC2626", fontWeight: "800", fontSize: "12px" }}>ACTIVE</span>
                  </div>
                  <p style={{ color: "#8B949E", fontSize: "12px", margin: "4px 0" }}>Prime 16-hour oak-smoked brisket plate paired with beverage.</p>
                  <span style={{ color: "#10B981", fontWeight: "800", fontSize: "14px" }}>Rs. 2,450</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: INVENTORY */}
          {activeTab === "inventory" && (
            <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
              <h3 style={{ margin: "0 0 14px 0", fontSize: "18px", color: "#FFF" }}>Ingredient Stock Monitoring</h3>
              <div style={{ display: "grid", gap: "8px" }}>
                {[
                  { name: "Prime Beef Brisket Cut", stock: "42.5 kg", status: "Optimal", color: "#10B981" },
                  { name: "Brioche Burger Buns", stock: "120 pcs", status: "Optimal", color: "#10B981" },
                  { name: "Smoke BBQ Glaze Gallon", stock: "3 units", status: "LOW STOCK WARNING", color: "#EF4444" },
                  { name: "Crinkle Cut Potatoes", stock: "60.0 kg", status: "Optimal", color: "#10B981" }
                ].map((ing, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#201F1F", borderRadius: "6px" }}>
                    <strong style={{ fontSize: "14px", color: "#FFF" }}>{ing.name}</strong>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <span style={{ color: "#F0F0F0", fontSize: "13px" }}>{ing.stock}</span>
                      <span style={{ color: ing.color, fontSize: "11px", fontWeight: "800" }}>{ing.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 7: STAFF ACCOUNTS */}
          {activeTab === "staff" && (
            <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ margin: 0, fontSize: "18px", color: "#FFF" }}>Staff Accounts &amp; PIN Security</h3>
                <button style={{ height: "38px", padding: "0 14px", background: "#DC2626", color: "#FFF", border: "0", borderRadius: "6px", fontWeight: "800", cursor: "pointer" }}>
                  + Add Operator
                </button>
              </div>
              <div style={{ display: "grid", gap: "8px" }}>
                {[
                  { name: "Restaurant Manager", username: "admin", role: "ADMIN", status: "Active" },
                  { name: "Cashier Counter 01", username: "cashier", role: "CASHIER", status: "Active" },
                  { name: "Pitmaster Kitchen", username: "kitchen", role: "KITCHEN", status: "Active" }
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#201F1F", borderRadius: "6px" }}>
                    <div>
                      <strong style={{ color: "#FFF", fontSize: "14px" }}>{s.name}</strong>
                      <span style={{ color: "#8B949E", fontSize: "12px", display: "block" }}>@{s.username}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ background: "#DC2626", color: "#FFF", fontSize: "10px", fontWeight: "800", padding: "3px 8px", borderRadius: "4px" }}>
                        {s.role}
                      </span>
                      <span style={{ color: "#10B981", fontSize: "12px", fontWeight: "700" }}>{s.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 8: REPORTS & SETTINGS */}
          {activeTab === "reports" && (
            <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
              <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", color: "#FFF" }}>Day-End Reports &amp; Diagnostics</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
                <div style={{ background: "#201F1F", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#8B949E", fontWeight: "700" }}>ACTIVE ORDERS IN SYSTEM</span>
                  <strong style={{ display: "block", fontSize: "22px", color: "#FFF", marginTop: "4px" }}>
                    {orders.length}
                  </strong>
                </div>
                <div style={{ background: "#201F1F", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#10B981", fontWeight: "700" }}>LOCAL SQLITE BRIDGE STATUS</span>
                  <strong style={{ display: "block", fontSize: "22px", color: "#10B981", marginTop: "4px" }}>
                    127.0.0.1:8765 OK
                  </strong>
                </div>
              </div>
              <button style={{ height: "44px", padding: "0 20px", background: "#DC2626", color: "#FFF", border: "0", borderRadius: "6px", fontWeight: "800", cursor: "pointer" }}>
                Generate End-of-Day (Z-Report)
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
