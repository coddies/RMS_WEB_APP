"use client";

import { useEffect, useRef, useState, FormEvent, ChangeEvent } from "react";
import Link from "next/link";

type Session = {
  userId?: string;
  staffId?: string;
  tenantSlug: string;
  username?: string;
  name: string;
  role: string;
};

type OrderItem = {
  id?: string;
  name: string;
  quantity: number;
  price?: number;
};

type Order = {
  id: string;
  order_number: number | string;
  table_id: string | null;
  table_number?: string | null;
  order_type: "DINE_IN" | "DELIVERY" | "PICKUP";
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  status: "PENDING" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
  payment_status?: string;
  items: OrderItem[];
  total_amount?: number;
  created_at: string;
  assigned_rider_id?: string | null;
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
  sort_order?: number;
  menu_items: MenuItem[];
};

type SpecialOffer = {
  id: string;
  menu_item_id: string;
  card_style: "flame" | "gradient" | "ribbon" | "countdown" | "seasonal_frame";
  badge_text: string | null;
  days_of_week: string[];
  start_at: string | null;
  end_at: string | null;
  run_indefinitely: boolean;
  item: {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    description: string | null;
    in_stock: boolean;
  } | null;
};

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  threshold: number;
};

type Vendor = {
  id: string;
  name: string;
  phone: string;
};

type SupplyProduct = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number | null;
};

type StaffMember = {
  id: string;
  name: string;
  username: string | null;
  phone: string | null;
  role: "admin" | "cashier" | "kitchen" | "rider";
  active: boolean;
};

type TenantSettings = {
  tenant_id: string;
  slug: string;
  brand_name: string;
  whatsapp_phone: string;
  supplier_marketplace_phone: string;
  notify_low_stock_phone: string;
  primary_color: string;
};

export default function StaffDashboard({ session: initialSession }: { session: Session }) {
  const [session, setSession] = useState<Session>(initialSession);
  const [activeTab, setActiveTab] = useState<
    "orders" | "kitchen" | "menu" | "offers" | "inventory" | "marketplace" | "staff" | "qrcodes" | "reports" | "settings"
  >("orders");

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<"all" | "dinein" | "delivery" | "pickup" | "urgent">("all");
  const [kitchenFilter, setKitchenFilter] = useState<"all" | "queued" | "cooking" | "ready">("all");
  const [approvedOrderIds, setApprovedOrderIds] = useState<Set<string>>(new Set());
  const [newOrderToast, setNewOrderToast] = useState<Order | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alertedOrderId, setAlertedOrderId] = useState<string | null>(null);
  const [orderActionLoading, setOrderActionLoading] = useState<Record<string, boolean>>({});
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Menu State
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuLoading, setMenuLoading] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemForm, setItemForm] = useState({
    name: "",
    price: "",
    category_id: "",
    description: "",
    image_url: "",
    in_stock: true
  });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  // Special Offers State
  const [offers, setOffers] = useState<SpecialOffer[]>([]);
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerForm, setOfferForm] = useState({
    menu_item_id: "",
    card_style: "flame" as SpecialOffer["card_style"],
    badge_text: "Weekend Chef Special",
    days_of_week: ["fri", "sat", "sun"],
    start_at: "",
    end_at: "",
    run_indefinitely: true
  });

  // Inventory State
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [showIngredientModal, setShowIngredientModal] = useState(false);
  const [ingredientForm, setIngredientForm] = useState({ name: "", unit: "kg", current_stock: "10", threshold: "5" });
  const [quickStockEditId, setQuickStockEditId] = useState<string | null>(null);
  const [quickStockVal, setQuickStockVal] = useState("");

  // Supplier Marketplace State
  const [supplyProducts, setSupplyProducts] = useState<SupplyProduct[]>([]);
  const [supplyCart, setSupplyCart] = useState<Record<string, number>>({});
  const [supplierPhone, setSupplierPhone] = useState("923157244884");
  const [marketplaceSubmitting, setMarketplaceSubmitting] = useState(false);

  // Staff Management State
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [staffForm, setStaffForm] = useState({ name: "", username: "", role: "cashier" as StaffMember["role"], pin: "" });

  // Settings State
  const [settings, setSettings] = useState<TenantSettings>({
    tenant_id: "",
    slug: session.tenantSlug,
    brand_name: "Ignite Smokehouse & Grill",
    whatsapp_phone: "923157244884",
    supplier_marketplace_phone: "923157244884",
    notify_low_stock_phone: "923157244884",
    primary_color: "#DC2626"
  });
  const [settingsNotice, setSettingsNotice] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);

  // QR Code State
  const [selectedTable, setSelectedTable] = useState("T-01");

  // Fast Switch / PIN Keypad Modal State
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinRole, setPinRole] = useState<"admin" | "cashier" | "kitchen" | "rider">("cashier");
  const [pinUsername, setPinUsername] = useState("cashier");
  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  // Global notice & error state
  const [dashboardNotice, setDashboardNotice] = useState("");
  const [dashboardError, setDashboardError] = useState("");

  const seenOrderIds = useRef<Set<string>>(new Set());

  // Sync approved orders with localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rms_approved_orders");
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          setApprovedOrderIds(new Set(arr));
        }
      }
    } catch {}
  }, []);

  // ── APPROVE ORDER HELPER (Moves from awaiting approval to kitchen queue) ──
  function approveOrder(orderId: string, orderNumber: string | number) {
    setApprovedOrderIds((prev) => {
      const next = new Set(prev);
      next.add(orderId);
      try {
        localStorage.setItem("rms_approved_orders", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });

    // Notify local bridge offline database if running
    const bridgeHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("rms_bridge_token") || localStorage.getItem("bridge_token");
      const session = localStorage.getItem("rms_staff_session") || localStorage.getItem("staff_session");
      if (token) bridgeHeaders["X-RMS-Bridge-Token"] = token;
      if (session) bridgeHeaders["X-RMS-Staff-Session"] = session;
    }
    if (bridgeHeaders["X-RMS-Bridge-Token"]) {
      void fetch("http://127.0.0.1:8765/counter/orders/approve", {
        method: "POST",
        headers: bridgeHeaders,
        body: JSON.stringify({ client_order_id: orderId })
      }).catch(() => {});
    }

    setDashboardNotice(`Order #${orderNumber} approved and sent to kitchen queue.`);
    setTimeout(() => setDashboardNotice(""), 3500);
  }

  // ── PRINT SLIP HELPER (Prints ticket to local POS printer or browser dialog) ──
  async function handlePrintSlip(order: Order) {
    // 1. Try sending directly to local bridge printer service
    try {
      const printHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (typeof window !== "undefined") {
        const token = localStorage.getItem("rms_bridge_token") || localStorage.getItem("bridge_token");
        const session = localStorage.getItem("rms_staff_session") || localStorage.getItem("staff_session");
        if (token) printHeaders["X-RMS-Bridge-Token"] = token;
        if (session) printHeaders["X-RMS-Staff-Session"] = session;
      }
      const res = await fetch("http://127.0.0.1:8765/print", {
        method: "POST",
        headers: printHeaders,
        body: JSON.stringify({
          client_order_id: order.id,
          order_number: `#${order.order_number}`,
          order_type: order.order_type,
          table_number: order.table_number,
          total_amount: order.total_amount,
          items: order.items,
          print_type: "KOT"
        })
      });
      if (res.ok) {
        setDashboardNotice(`Printed kitchen ticket for Order #${order.order_number}.`);
        setTimeout(() => setDashboardNotice(""), 3000);
        return;
      }
    } catch {}

    // 2. Fallback: Browser printing pop-up slip
    const printWindow = window.open("", "_blank", "width=380,height=600");
    if (printWindow) {
      const itemsHtml = order.items
        .map(
          (it) =>
            `<div style="display:flex;justify-content:space-between;margin:4px 0;font-size:12px;"><span>${it.quantity}x ${it.name}</span><span>${it.price ? `Rs ${it.price * it.quantity}` : ""}</span></div>`
        )
        .join("");
      printWindow.document.write(`
        <html>
          <head>
            <title>Kitchen Ticket - #${order.order_number}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; font-size: 13px; padding: 14px; margin: 0; color: #000; }
              .header { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; margin-bottom: 10px; }
              .footer { border-top: 2px dashed #000; padding-top: 8px; margin-top: 10px; text-align: right; font-weight: bold; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h2 style="margin:0;font-size:18px;">IGNITE SMOKEHOUSE &amp; GRILL</h2>
              <div style="font-size:12px;margin:2px 0;">Order #${order.order_number}</div>
              <div style="font-weight:bold;font-size:13px;">${order.order_type === "DINE_IN" ? `Table ${order.table_number || "STAND"}` : order.order_type}</div>
              <div style="font-size:11px;color:#555;">${new Date(order.created_at).toLocaleTimeString()}</div>
            </div>
            <div>${itemsHtml}</div>
            <div class="footer">
              TOTAL: Rs ${order.total_amount || 0}
            </div>
            <script>
              window.onload = function() { window.print(); window.close(); }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  }

  // Single short notification sound per new order (Web Audio Synth - no external assets needed)
  function playNewOrderSound() {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }

  // ── LOAD ORDERS ──
  async function loadOrders() {
    try {
      const res = await fetch("/api/orders?status=all", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const fetched = (data.orders || []) as Order[];

      // Detect new incoming order for single toast + single sound
      const newlyFound = fetched.find((o) => !seenOrderIds.current.has(o.id));
      if (newlyFound && seenOrderIds.current.size > 0) {
        setNewOrderToast(newlyFound);
        playNewOrderSound();
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => {
          setNewOrderToast(null);
        }, 5500);
      }
      fetched.forEach((o) => seenOrderIds.current.add(o.id));
      setOrders(fetched);
    } catch {}
  }

  // ── LOAD MENU ──
  async function loadMenu() {
    setMenuLoading(true);
    try {
      const res = await fetch("/api/admin/menu", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
        if (data.ingredients) setIngredients(data.ingredients);
      }
    } catch {}
    setMenuLoading(false);
  }

  // ── LOAD OFFERS ──
  async function loadOffers() {
    try {
      const res = await fetch("/api/admin/offers", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setOffers(data.offers || []);
      }
    } catch {}
  }

  // ── LOAD INVENTORY ──
  async function loadInventory() {
    try {
      const res = await fetch("/api/admin/inventory", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setIngredients(data.ingredients || []);
        setVendors(data.vendors || []);
      }
    } catch {}
  }

  // ── LOAD MARKETPLACE ──
  async function loadMarketplace() {
    try {
      const res = await fetch("/api/admin/marketplace", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setSupplyProducts(data.products || []);
        if (data.supplier_phone) setSupplierPhone(data.supplier_phone);
      }
    } catch {}
  }

  // ── LOAD STAFF ──
  async function loadStaff() {
    try {
      const res = await fetch("/api/admin/staff", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStaffList(data.staff || []);
      }
    } catch {}
  }

  // ── LOAD SETTINGS ──
  async function loadSettings() {
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) setSettings(data.settings);
      }
    } catch {}
  }

  // Polling loop
  useEffect(() => {
    void loadOrders();
    void loadMenu();
    void loadOffers();
    void loadInventory();
    void loadMarketplace();
    void loadStaff();
    void loadSettings();

    const orderInterval = setInterval(loadOrders, 5000);
    return () => clearInterval(orderInterval);
  }, []);

  // ── ORDER STATUS TRANSITION (A2, A3, B3) ──
  async function updateOrderStatus(orderId: string, targetStatus: Order["status"], assignedRiderId?: string | null) {
    setOrderActionLoading((prev) => ({ ...prev, [orderId]: true }));
    try {
      // Optimistic update
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: targetStatus, assigned_rider_id: assignedRiderId ?? o.assigned_rider_id } : o))
      );

      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, status: targetStatus, assigned_rider_id: assignedRiderId })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update order status");
      }
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Order update failed.");
      setTimeout(() => setDashboardError(""), 4000);
      void loadOrders(); // rollback
    } finally {
      setOrderActionLoading((prev) => ({ ...prev, [orderId]: false }));
    }
  }

  // ── MENU ITEM IN-STOCK TOGGLE ──
  async function toggleItemStock(itemId: string, currentStock: boolean) {
    try {
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          menu_items: cat.menu_items.map((it) => (it.id === itemId ? { ...it, in_stock: !currentStock } : it))
        }))
      );
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stock", id: itemId, in_stock: !currentStock })
      });
      if (!res.ok) throw new Error("Could not update stock.");
    } catch (err) {
      void loadMenu();
    }
  }

  // ── PHOTO UPLOAD TO CLOUDINARY ──
  async function handlePhotoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/menu/photo", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.secure_url) {
        throw new Error(data.error || "Failed to upload photo to Cloudinary.");
      }
      setItemForm((prev) => ({ ...prev, image_url: data.secure_url }));
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Photo upload failed.");
      setTimeout(() => setDashboardError(""), 4000);
    } finally {
      setPhotoUploading(false);
    }
  }

  // ── SAVE MENU ITEM ──
  async function handleSaveMenuItem(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          id: editingItem?.id,
          name: itemForm.name,
          price: Number(itemForm.price),
          category_id: itemForm.category_id || categories[0]?.id,
          description: itemForm.description,
          image_url: itemForm.image_url || null,
          in_stock: itemForm.in_stock
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save menu item.");
      setShowItemModal(false);
      setEditingItem(null);
      setItemForm({ name: "", price: "", category_id: "", description: "", image_url: "", in_stock: true });
      void loadMenu();
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Item save failed.");
      setTimeout(() => setDashboardError(""), 4000);
    }
  }

  // ── DELETE MENU ITEM ──
  async function handleDeleteMenuItem(id: string) {
    if (!confirm("Are you sure you want to remove this item?")) return;
    try {
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete item.");
      void loadMenu();
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Delete failed.");
      setTimeout(() => setDashboardError(""), 4000);
    }
  }

  // ── CREATE CATEGORY ──
  async function handleCreateCategory(e: FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const res = await fetch("/api/admin/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_category", name: newCategoryName.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create category.");
      setNewCategoryName("");
      setShowCategoryModal(false);
      void loadMenu();
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Failed to create category.");
      setTimeout(() => setDashboardError(""), 4000);
    }
  }

  // ── SAVE SPECIAL OFFER ──
  async function handleSaveOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerForm.menu_item_id) {
      alert("Please select a menu item.");
      return;
    }
    try {
      const res = await fetch("/api/admin/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(offerForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save special offer.");
      setShowOfferModal(false);
      void loadOffers();
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Offer save failed.");
      setTimeout(() => setDashboardError(""), 4000);
    }
  }

  // ── DELETE SPECIAL OFFER ──
  async function handleDeleteOffer(id: string) {
    if (!confirm("Delete this promotional deal?")) return;
    try {
      const res = await fetch(`/api/admin/offers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete offer.");
      void loadOffers();
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Failed to delete offer.");
      setTimeout(() => setDashboardError(""), 4000);
    }
  }

  // ── INVENTORY ACTIONS (D1) ──
  async function handleQuickStockUpdate(id: string) {
    const val = Number(quickStockVal);
    if (!Number.isFinite(val)) return;
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_stock", id, current_stock: val })
      });
      if (!res.ok) throw new Error("Failed to update stock.");
      setQuickStockEditId(null);
      void loadInventory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Stock update failed.");
    }
  }

  async function handleVendorAlert(ing: Ingredient) {
    try {
      const res = await fetch("/api/admin/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vendor_alert",
          name: ing.name,
          unit: ing.unit,
          order_quantity: Math.max(10, ing.threshold * 2),
          vendor_phone: settings.notify_low_stock_phone || "923157244884"
        })
      });
      const data = await res.json();
      if (data.wa_url) {
        window.open(data.wa_url, "_blank");
      }
    } catch {}
  }

  // ── MARKETPLACE CART & WHATSAPP (D2) ──
  function updateMarketplaceCart(productId: string, delta: number) {
    setSupplyCart((prev) => {
      const cur = prev[productId] || 0;
      const next = cur + delta;
      if (next <= 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  }

  async function submitMarketplaceOrder() {
    const items = Object.entries(supplyCart)
      .map(([id, qty]) => {
        const prod = supplyProducts.find((p) => p.id === id);
        return prod ? { product_id: id, name: prod.name, quantity: qty, price: prod.price } : null;
      })
      .filter(Boolean) as { product_id: string; name: string; quantity: number; price: number | null }[];

    if (items.length === 0) return;
    setMarketplaceSubmitting(true);
    try {
      const res = await fetch("/api/admin/marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit marketplace order.");
      if (data.wa_url) {
        window.open(data.wa_url, "_blank");
      }
      setSupplyCart({});
      setDashboardNotice("Stock order created and WhatsApp message prepared!");
      setTimeout(() => setDashboardNotice(""), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Marketplace order failed.");
    } finally {
      setMarketplaceSubmitting(false);
    }
  }

  // ── SAVE SETTINGS ──
  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSettingsSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save settings.");
      setSettingsNotice("Settings successfully updated!");
      setTimeout(() => setSettingsNotice(""), 3500);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSettingsSaving(false);
    }
  }

  // ── FAST PIN UNLOCK / ROLE SWITCH (A1) ──
  async function submitPinLogin(e?: FormEvent) {
    if (e) e.preventDefault();
    setPinError("");
    setPinBusy(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant: session.tenantSlug,
          role: pinRole,
          identity: pinRole === "rider" ? "03001234567" : pinUsername,
          credential: enteredPin
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid security passcode. Try again.");
      }

      setSession((prev) => ({
        ...prev,
        role: pinRole,
        username: pinUsername,
        name: data.name || pinUsername
      }));
      setShowPinModal(false);
      setEnteredPin("");
      setDashboardNotice(`Switched to ${data.name || pinUsername} (${pinRole.toUpperCase()})`);
      setTimeout(() => setDashboardNotice(""), 3000);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Invalid security passcode. Try again.");
      setEnteredPin("");
    } finally {
      setPinBusy(false);
    }
  }

  // Computed data
  const allMenuItems = categories.flatMap((c) => c.menu_items);
  const inStockCount = allMenuItems.filter((i) => i.in_stock).length;
  const soldOutCount = allMenuItems.length - inStockCount;

  // Active orders stats & ledger computation
  const now = Date.now();
  let delayedCount = 0;
  let cookingCount = 0;
  let readyCount = 0;
  let totalWaitSec = 0;
  let activeCount = 0;

  orders.forEach((o) => {
    const ageSec = Math.max(0, Math.floor((now - new Date(o.created_at).getTime()) / 1000));
    const ageMin = Math.floor(ageSec / 60);
    const isDelayed = ageMin >= 15 && o.status !== "COMPLETED" && o.status !== "CANCELLED";
    if (isDelayed) delayedCount++;
    if (o.status === "PREPARING") cookingCount++;
    if (o.status === "READY") readyCount++;
    if (o.status !== "COMPLETED" && o.status !== "CANCELLED") {
      totalWaitSec += ageSec;
      activeCount++;
    }
  });

  const avgSec = activeCount > 0 ? Math.floor(totalWaitSec / activeCount) : 0;
  const avgMin = Math.floor(avgSec / 60);
  const avgRemSec = avgSec % 60;
  const avgWaitText = `${avgMin}m ${avgRemSec}s`;

  // Filtered orders for Orders Tab
  const filteredOrders = orders.filter((o) => {
    if (orderFilter === "dinein" && o.order_type !== "DINE_IN") return false;
    if (orderFilter === "delivery" && o.order_type !== "DELIVERY" && o.order_type !== "PICKUP") return false;
    if (orderFilter === "urgent") {
      const minsOld = (now - new Date(o.created_at).getTime()) / 60000;
      if (minsOld < 15 || o.status === "COMPLETED" || o.status === "CANCELLED") return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNum = String(o.order_number).includes(q);
      const matchCust = (o.customer_name || "").toLowerCase().includes(q) || (o.customer_phone || "").includes(q);
      const matchTable = (o.table_number || "").toLowerCase().includes(q);
      const matchItems = o.items.some((it) => it.name.toLowerCase().includes(q));
      if (!matchNum && !matchCust && !matchTable && !matchItems) return false;
    }
    return true;
  });

  // Approved tickets active for Kitchen (KDS)
  const approvedOrders = orders.filter((o) => {
    const isApproved = approvedOrderIds.has(o.id) || o.status === "PREPARING" || o.status === "READY";
    return isApproved && o.status !== "COMPLETED" && o.status !== "CANCELLED";
  });

  const kitchenTickets = approvedOrders.filter((ticket) => {
    if (kitchenFilter === "queued" && ticket.status !== "PENDING") return false;
    if (kitchenFilter === "cooking" && ticket.status !== "PREPARING") return false;
    if (kitchenFilter === "ready" && ticket.status !== "READY") return false;
    return true;
  });

  const kdsReceived = approvedOrders.filter((o) => o.status === "PENDING");
  const kdsPreparing = approvedOrders.filter((o) => o.status === "PREPARING");
  const kdsReady = approvedOrders.filter((o) => o.status === "READY");

  // Selected item for Special Offer preview
  const selectedOfferItem = allMenuItems.find((i) => i.id === offerForm.menu_item_id);

  const qrTargetUrl = typeof window !== "undefined"
    ? `${window.location.origin}/menu?tenant=${encodeURIComponent(session.tenantSlug)}&table=${encodeURIComponent(selectedTable)}&type=dinein`
    : `https://rms-web-app-rho.vercel.app/menu?tenant=${session.tenantSlug}&table=${selectedTable}&type=dinein`;
  const qrCodeUrl = `/qrcodes/table-${selectedTable}-qr.png`;

  return (
    <div style={{ display: "flex", height: "100vh", maxHeight: "100vh", overflow: "hidden", background: "#0D0D0D", color: "#E5E2E1", fontFamily: "Inter, sans-serif" }}>
      {/* ── LEFT SIDEBAR ── */}
      <aside
        style={{
          width: "250px",
          height: "100vh",
          maxHeight: "100vh",
          position: "sticky",
          top: 0,
          left: 0,
          background: "#131313",
          borderRight: "1px solid #2A2A2A",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 40,
          overflowY: "auto",
          scrollbarWidth: "none"
        }}
      >
        {/* Brand Banner */}
        <div style={{ padding: "20px 16px", borderBottom: "1px solid #2A2A2A", flexShrink: 0 }}>
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
                fontWeight: "900",
                color: "#FFFFFF",
                fontSize: "18px"
              }}
            >
              I
            </div>
            <div>
              <strong style={{ display: "block", fontSize: "14px", color: "#FFFFFF", lineHeight: 1.2 }}>
                {settings.brand_name.toUpperCase()}
              </strong>
              <span style={{ fontSize: "11px", color: "#8B949E", letterSpacing: "0.5px" }}>
                {session.tenantSlug.toUpperCase()} · TERMINAL
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav style={{ padding: "12px 8px", flex: 1, display: "flex", flexDirection: "column", gap: "4px", overflowY: "auto", scrollbarWidth: "thin" }}>
          {[
            { id: "orders", label: "Live Orders", count: orders.filter((o) => o.status !== "COMPLETED").length },
            { id: "kitchen", label: "Kitchen (KDS)", count: kdsReceived.length + kdsPreparing.length },
            { id: "menu", label: "Menu Management", count: allMenuItems.length },
            { id: "offers", label: "Special Offers", count: offers.length },
            { id: "inventory", label: "Inventory & Alerts", count: ingredients.filter((i) => i.current_stock <= i.threshold).length },
            { id: "marketplace", label: "Supplier Marketplace", badge: "STOCK" },
            { id: "qrcodes", label: "Table QR Codes" },
            { id: "staff", label: "Staff Accounts" },
            { id: "reports", label: "Daily Reports" },
            { id: "settings", label: "System Settings" }
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                style={{
                  width: "100%",
                  height: "42px",
                  padding: "0 12px",
                  borderRadius: "6px",
                  border: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: active ? "#DC2626" : "transparent",
                  color: active ? "#FFFFFF" : "#C9D1D9",
                  fontSize: "13px",
                  fontWeight: active ? "700" : "500",
                  cursor: "pointer",
                  textAlign: "left"
                }}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span
                    style={{
                      background: active ? "rgba(0,0,0,0.3)" : "#222736",
                      color: "#FFFFFF",
                      fontSize: "11px",
                      padding: "2px 7px",
                      borderRadius: "999px",
                      fontWeight: "700"
                    }}
                  >
                    {tab.count}
                  </span>
                )}
                {tab.badge && (
                  <span style={{ background: "#F59E0B", color: "#111", fontSize: "9px", padding: "1px 5px", borderRadius: "3px", fontWeight: "800" }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Station Status & User Profile (A1) */}
        <div style={{ padding: "12px", borderTop: "1px solid #2A2A2A", flexShrink: 0, marginTop: "auto", background: "#131313" }}>
          <div
            style={{
              padding: "8px 10px",
              background: "#181818",
              border: "1px solid #2A2A2A",
              borderRadius: "6px",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10B981" }} />
              <span style={{ fontSize: "10px", color: "#8B949E", fontWeight: "700" }}>ONLINE</span>
            </div>
            <span style={{ fontSize: "10px", color: "#10B981", fontWeight: "800" }}>SQLITE SYNC</span>
          </div>

          <div style={{ padding: "10px", background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px" }}>
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

            <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
              {/* Fast Switch User / PIN Lock button (A1) */}
              <button
                type="button"
                onClick={() => {
                  setEnteredPin("");
                  setPinError("");
                  setShowPinModal(true);
                }}
                style={{
                  flex: 1,
                  height: "32px",
                  background: "#2A2A2A",
                  color: "#FFFFFF",
                  border: 0,
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: "700",
                  cursor: "pointer"
                }}
              >
                Switch / Lock
              </button>

              {/* Sign out */}
              <form action="/api/auth/logout" method="post" style={{ margin: 0 }}>
                <button
                  type="submit"
                  style={{
                    height: "32px",
                    padding: "0 10px",
                    background: "#1F2328",
                    color: "#8B949E",
                    border: 0,
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  Exit
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100vh", maxHeight: "100vh", overflow: "hidden" }}>
        {/* Top Header */}
        <header
          style={{
            height: "64px",
            background: "#161B22",
            borderBottom: "1px solid #222736",
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "38px",
                height: "38px",
                borderRadius: "8px",
                background: "#DC2626",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "900",
                color: "#FFFFFF",
                fontSize: "18px"
              }}
            >
              I
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "16px", fontWeight: "800", color: "#F0F0F0", letterSpacing: "0.5px" }}>
                {settings.brand_name.toUpperCase()}
              </span>
              <span style={{ fontSize: "11px", color: "#8B949E", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Main Dining Floor &amp; Smokehouse Pit
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {/* KDS SYNCED Status Pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 14px",
                borderRadius: "6px",
                background: "#1A1E29",
                border: "1px solid #222736"
              }}
            >
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10B981" }} />
              <span style={{ fontSize: "11px", fontWeight: "700", color: "#F0F0F0", letterSpacing: "0.5px" }}>
                KDS SYNCED
              </span>
            </div>

            {/* Operator Info */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", borderLeft: "1px solid #222736", paddingLeft: "14px" }}>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#F0F0F0", display: "block" }}>{session.name}</span>
                <span style={{ fontSize: "10px", color: "#DC2626", fontWeight: "700", textTransform: "uppercase" }}>{session.role}</span>
              </div>
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "50%",
                  background: "#DC2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFF",
                  fontWeight: "800",
                  fontSize: "13px"
                }}
              >
                {session.name.charAt(0).toUpperCase()}
              </div>
            </div>

            {/* Customer Menu Link */}
            <Link
              href="/"
              target="_blank"
              style={{
                height: "36px",
                padding: "0 16px",
                background: "#DC2626",
                color: "#FFFFFF",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "700",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span>View Guest Menu</span>
            </Link>
          </div>
        </header>

        {/* Global Notices */}
        {dashboardNotice && (
          <div style={{ background: "#065F46", color: "#FFFFFF", padding: "8px 24px", fontSize: "12px", fontWeight: "700" }}>
            {dashboardNotice}
          </div>
        )}
        {dashboardError && (
          <div style={{ background: "#7F1D1D", color: "#FFFFFF", padding: "8px 24px", fontSize: "12px", fontWeight: "700" }}>
            {dashboardError}
          </div>
        )}

        {/* Tab View Container */}
        <main style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 1: LIVE ORDERS (SIMPLIFIED UNIFIED FLOW) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "orders" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Operational Metric Bar & Filters */}
              <div
                style={{
                  background: "#161B22",
                  border: "1px solid #222736",
                  borderRadius: "10px",
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px"
                }}
              >
                {/* Filter Tabs */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  {[
                    { id: "all", label: "All", count: orders.length },
                    { id: "dinein", label: "Dine-In", count: orders.filter((o) => o.order_type === "DINE_IN").length },
                    { id: "delivery", label: "Delivery", count: orders.filter((o) => o.order_type === "DELIVERY" || o.order_type === "PICKUP").length },
                    { id: "urgent", label: "Urgent (>15m)", count: delayedCount, isUrgent: true }
                  ].map((f) => {
                    const isSelected = orderFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setOrderFilter(f.id as typeof orderFilter)}
                        style={{
                          height: "40px",
                          padding: "0 16px",
                          borderRadius: "8px",
                          border: isSelected ? 0 : "1px solid #2C3240",
                          background: isSelected ? "#DC2626" : "#1A1E29",
                          color: isSelected ? "#FFFFFF" : f.isUrgent ? "#EF4444" : "#8B949E",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px"
                        }}
                      >
                        <span>{f.label}</span>
                        <span
                          style={{
                            background: isSelected ? "rgba(0,0,0,0.3)" : "#222736",
                            padding: "2px 6px",
                            borderRadius: "999px",
                            fontSize: "10px"
                          }}
                        >
                          {f.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Search & Avg Wait */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, maxWidth: "520px" }}>
                  <input
                    type="text"
                    placeholder="Search order #, table, customer or item..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      flex: 1,
                      height: "40px",
                      background: "#0D0D0D",
                      border: "1px solid #2C3240",
                      borderRadius: "8px",
                      padding: "0 14px",
                      color: "#F0F0F0",
                      fontSize: "12px"
                    }}
                  />
                  <div
                    style={{
                      height: "40px",
                      padding: "0 14px",
                      borderRadius: "8px",
                      background: "#0D0D0D",
                      border: "1px solid #2C3240",
                      display: "flex",
                      alignItems: "center",
                      fontSize: "12px",
                      color: "#8B949E",
                      whiteSpace: "nowrap"
                    }}
                  >
                    Avg Wait: <strong style={{ color: "#F0F0F0", marginLeft: "4px" }}>{avgWaitText}</strong>
                  </div>
                </div>
              </div>

              {/* Order Cards Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "16px" }}>
                {filteredOrders.length === 0 ? (
                  <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "80px 20px", color: "#8B949E" }}>
                    No orders matching this filter.
                  </div>
                ) : (
                  filteredOrders.map((order) => {
                    const ageSec = Math.max(0, Math.floor((now - new Date(order.created_at).getTime()) / 1000));
                    const totalMins = Math.floor(ageSec / 60);
                    const remSecs = ageSec % 60;
                    const ageText = `${totalMins}m ${remSecs}s`;
                    const isDelayed = totalMins >= 15 && order.status !== "COMPLETED" && order.status !== "CANCELLED";
                    const isApproved = approvedOrderIds.has(order.id) || order.status === "PREPARING" || order.status === "READY" || order.status === "COMPLETED";

                    return (
                      <article
                        key={order.id}
                        style={{
                          background: "#161B22",
                          border: isDelayed ? "1px solid #920703" : "1px solid #222736",
                          borderRadius: "10px",
                          overflow: "hidden",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.4)"
                        }}
                      >
                        <div>
                          {/* Top Urgency Ribbon */}
                          <div
                            style={{
                              background: isDelayed ? "#920703" : "#1A1E29",
                              padding: "8px 14px",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center"
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: "800",
                                letterSpacing: "0.5px",
                                color: isDelayed ? "#FFFFFF" : "#8B949E",
                                textTransform: "uppercase"
                              }}
                            >
                              {isDelayed ? "DELAYED CRITICAL: >15m" : "WAIT TIME"}
                            </span>
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: "800",
                                color: isDelayed ? "#FFFFFF" : "#F0F0F0"
                              }}
                            >
                              {ageText}
                            </span>
                          </div>

                          {/* Header Section */}
                          <div style={{ padding: "14px 14px 10px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                              <div>
                                <span style={{ fontSize: "18px", fontWeight: "800", color: "#F0F0F0", display: "block", letterSpacing: "-0.5px" }}>
                                  #ORD-{order.order_number}
                                </span>
                                <span style={{ fontSize: "11px", color: "#8B949E" }}>
                                  {order.order_type === "DINE_IN" ? `Table ${order.table_number || "STAND"}` : order.customer_name || "Online Guest"} · QR Terminal
                                </span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                                <span
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "4px",
                                    fontSize: "10px",
                                    fontWeight: "800",
                                    background: "#1A1E29",
                                    color: "#F0F0F0",
                                    border: "1px solid #222736"
                                  }}
                                >
                                  {order.order_type === "DINE_IN"
                                    ? `Table #${order.table_number || "01"}`
                                    : order.order_type === "DELIVERY"
                                    ? "Delivery"
                                    : "Pickup"}
                                </span>
                                <span
                                  style={{
                                    padding: "2px 7px",
                                    borderRadius: "4px",
                                    fontSize: "10px",
                                    fontWeight: "800",
                                    background: !isApproved
                                      ? "#920703"
                                      : order.status === "PREPARING"
                                      ? "#2A1F11"
                                      : order.status === "READY"
                                      ? "#133526"
                                      : "#1A1E29",
                                    color: !isApproved
                                      ? "#FFFFFF"
                                      : order.status === "PREPARING"
                                      ? "#F59E0B"
                                      : order.status === "READY"
                                      ? "#10B981"
                                      : "#3B82F6"
                                  }}
                                >
                                  {!isApproved
                                    ? "AWAITING APPROVAL"
                                    : order.status === "PREPARING"
                                    ? "COOKING"
                                    : order.status === "READY"
                                    ? "READY"
                                    : order.status === "COMPLETED"
                                    ? "COMPLETED"
                                    : "IN KITCHEN"}
                                </span>
                              </div>
                            </div>

                            {/* Customer info for Delivery / Pickup */}
                            {order.order_type === "DELIVERY" && (
                              <div
                                style={{
                                  background: "#1A1E29",
                                  padding: "8px 10px",
                                  borderRadius: "6px",
                                  marginBottom: "10px",
                                  fontSize: "11px",
                                  border: "1px solid #222736"
                                }}
                              >
                                <strong style={{ color: "#F0F0F0" }}>{order.customer_name || "Guest Customer"}</strong>
                                <span style={{ color: "#8B949E", display: "block" }}>{order.customer_phone}</span>
                                <span style={{ color: "#E5E2E1", display: "block", marginTop: "2px" }}>{order.customer_address}</span>
                              </div>
                            )}

                            {/* Items Ledger with Item Thumbnail */}
                            <div style={{ borderTop: "1px solid #222736", borderBottom: "1px solid #222736", padding: "8px 0", margin: "8px 0" }}>
                              {order.items.map((it, idx) => (
                                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "6px 0" }}>
                                  {/* 32x32 item thumbnail per DESIGN_FINAL §2.1 */}
                                  <div
                                    style={{
                                      width: "32px",
                                      height: "32px",
                                      borderRadius: "6px",
                                      background: "#1A1E29",
                                      border: "1px solid #222736",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "14px",
                                      flexShrink: 0,
                                      overflow: "hidden"
                                    }}
                                  >
                                    🍽️
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#F0F0F0", fontWeight: "700" }}>
                                      <span>{it.quantity}x {it.name}</span>
                                      {it.price && <span style={{ color: "#8B949E", fontWeight: "400" }}>Rs {it.price * it.quantity}</span>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Payment Summary */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "4px" }}>
                              <span style={{ fontSize: "11px", fontWeight: "700", color: order.payment_status === "PAID" ? "#10B981" : "#8B949E" }}>
                                {order.order_type === "DINE_IN"
                                  ? order.payment_status === "PAID" ? "Paid Dine-In" : "Unpaid Dine-In"
                                  : order.payment_status === "PAID" ? "Paid Online" : "Cash on Delivery"}
                              </span>
                              <div style={{ textAlign: "right" }}>
                                <span style={{ fontSize: "10px", color: "#8B949E", display: "block", lineHeight: 1 }}>TOTAL</span>
                                <span style={{ fontSize: "16px", fontWeight: "800", color: "#FFFFFF" }}>
                                  Rs {order.total_amount || 0}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons Footer - EXACTLY TWO ACTIONS */}
                        <div style={{ padding: "0 14px 14px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          {/* Action 1: Approve or Read-Only Status */}
                          {!isApproved ? (
                            <button
                              onClick={() => approveOrder(order.id, order.order_number)}
                              style={{
                                height: "38px",
                                background: "#DC2626",
                                color: "#FFFFFF",
                                border: 0,
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px"
                              }}
                            >
                              <span>✓</span> Approve
                            </button>
                          ) : (
                            <div
                              style={{
                                height: "38px",
                                background: "#1A1E29",
                                border: "1px solid #222736",
                                borderRadius: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "12px",
                                fontWeight: "700",
                                color:
                                  order.status === "READY"
                                    ? "#10B981"
                                    : order.status === "PREPARING"
                                    ? "#F59E0B"
                                    : order.status === "COMPLETED"
                                    ? "#10B981"
                                    : "#3B82F6"
                              }}
                            >
                              {order.status === "READY"
                                ? "Ready"
                                : order.status === "PREPARING"
                                ? "Cooking"
                                : order.status === "COMPLETED"
                                ? "Completed"
                                : "In Kitchen"}
                            </div>
                          )}

                          {/* Action 2: Print Slip */}
                          <button
                            onClick={() => handlePrintSlip(order)}
                            style={{
                              height: "38px",
                              background: "#1A1E29",
                              color: "#F0F0F0",
                              border: "1px solid #222736",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "4px"
                            }}
                          >
                            <span>🖨️</span> Print Slip
                          </button>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {/* Active Station Footer Ledger */}
              <div
                style={{
                  marginTop: "16px",
                  padding: "14px 18px",
                  background: "#161B22",
                  borderRadius: "10px",
                  border: "1px solid #222736",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "18px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#EF4444" }} />
                    <span style={{ fontSize: "12px", color: "#8B949E" }}>Delayed &gt; 15m ({delayedCount})</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#F59E0B" }} />
                    <span style={{ fontSize: "12px", color: "#8B949E" }}>In Kitchen ({cookingCount})</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10B981" }} />
                    <span style={{ fontSize: "12px", color: "#8B949E" }}>Ready for Service ({readyCount})</span>
                  </div>
                </div>
                <button
                  onClick={() => void loadOrders()}
                  style={{
                    height: "36px",
                    padding: "0 16px",
                    background: "#DC2626",
                    color: "#FFFFFF",
                    border: 0,
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "700",
                    cursor: "pointer"
                  }}
                >
                  Sync All Tickets
                </button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 2: KITCHEN DISPLAY SYSTEM (KDS) (SIMPLIFIED UNIFIED FLOW) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "kitchen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Kitchen Metric Bar & Tabs */}
              <div
                style={{
                  background: "#161B22",
                  border: "1px solid #222736",
                  borderRadius: "10px",
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px"
                }}
              >
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  {[
                    { id: "all", label: "All Tickets", count: approvedOrders.length },
                    { id: "queued", label: "Queued", count: kdsReceived.length },
                    { id: "cooking", label: "Cooking", count: kdsPreparing.length },
                    { id: "ready", label: "Ready", count: kdsReady.length }
                  ].map((f) => {
                    const isSelected = kitchenFilter === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => setKitchenFilter(f.id as typeof kitchenFilter)}
                        style={{
                          height: "40px",
                          padding: "0 16px",
                          borderRadius: "8px",
                          border: isSelected ? 0 : "1px solid #2C3240",
                          background: isSelected ? "#DC2626" : "#1A1E29",
                          color: isSelected ? "#FFFFFF" : "#8B949E",
                          fontSize: "12px",
                          fontWeight: "700",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px"
                        }}
                      >
                        <span>{f.label}</span>
                        <span
                          style={{
                            background: isSelected ? "rgba(0,0,0,0.3)" : "#222736",
                            padding: "2px 6px",
                            borderRadius: "999px",
                            fontSize: "10px"
                          }}
                        >
                          {f.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  style={{
                    height: "40px",
                    padding: "0 14px",
                    borderRadius: "8px",
                    background: "#0D0D0D",
                    border: "1px solid #2C3240",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                >
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10B981" }} />
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#10B981" }}>KDS ACTIVE</span>
                </div>
              </div>

              {/* Kitchen Tickets Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: "16px" }}>
                {kitchenTickets.length === 0 ? (
                  <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "80px 20px", color: "#8B949E" }}>
                    No active kitchen tickets in this section.
                  </div>
                ) : (
                  kitchenTickets.map((ticket) => {
                    const ageSec = Math.max(0, Math.floor((now - new Date(ticket.created_at).getTime()) / 1000));
                    const totalMins = Math.floor(ageSec / 60);
                    const remSecs = ageSec % 60;
                    const ageText = `${totalMins}m ${remSecs}s`;
                    const isDelayed = totalMins >= 15;
                    const isReady = ticket.status === "READY";
                    const isCooking = ticket.status === "PREPARING";
                    const isPending = ticket.status === "PENDING";

                    return (
                      <article
                        key={ticket.id}
                        style={{
                          background: "#161B22",
                          border: isReady ? "2px solid #10B981" : isDelayed ? "1px solid #920703" : "1px solid #222736",
                          borderRadius: "10px",
                          overflow: "hidden",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          boxShadow: "0 4px 16px rgba(0,0,0,0.4)"
                        }}
                      >
                        <div>
                          {/* Top Ribbon */}
                          <div
                            style={{
                              background: isReady ? "#133526" : isDelayed ? "#920703" : "#1A1E29",
                              padding: "8px 14px",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center"
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10px",
                                fontWeight: "800",
                                letterSpacing: "0.5px",
                                color: isReady ? "#10B981" : isDelayed ? "#FFFFFF" : "#8B949E",
                                textTransform: "uppercase"
                              }}
                            >
                              {isReady ? "READY ON PASS" : isDelayed ? "VIP CRITICAL WAIT: >15m" : "KITCHEN TIMER"}
                            </span>
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: "800",
                                color: isReady ? "#10B981" : isDelayed ? "#FFFFFF" : "#F0F0F0"
                              }}
                            >
                              {ageText}
                            </span>
                          </div>

                          {/* Header */}
                          <div style={{ padding: "14px 14px 10px 14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                              <div>
                                <span style={{ fontSize: "18px", fontWeight: "800", color: "#F0F0F0", display: "block", letterSpacing: "-0.5px" }}>
                                  #ORD-{ticket.order_number}
                                </span>
                                <span style={{ fontSize: "11px", color: "#8B949E" }}>
                                  {ticket.order_type === "DINE_IN" ? `Table ${ticket.table_number || "STAND"}` : ticket.customer_name || "Online Order"}
                                </span>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                                <span
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: "4px",
                                    fontSize: "10px",
                                    fontWeight: "800",
                                    background: "#1A1E29",
                                    color: "#F0F0F0",
                                    border: "1px solid #222736"
                                  }}
                                >
                                  {ticket.order_type === "DINE_IN" ? `Table #${ticket.table_number || "01"}` : ticket.order_type}
                                </span>
                                <span
                                  style={{
                                    padding: "2px 7px",
                                    borderRadius: "4px",
                                    fontSize: "10px",
                                    fontWeight: "800",
                                    background: isReady ? "#133526" : isCooking ? "#2A1F11" : "#1A1E29",
                                    color: isReady ? "#10B981" : isCooking ? "#F59E0B" : "#3B82F6"
                                  }}
                                >
                                  {isReady ? "READY" : isCooking ? "COOKING" : "QUEUED"}
                                </span>
                              </div>
                            </div>

                            {/* Items Ledger */}
                            <div style={{ borderTop: "1px solid #222736", padding: "8px 0", margin: "8px 0" }}>
                              {ticket.items.map((it, idx) => (
                                <div key={idx} style={{ display: "flex", alignItems: "center", gap: "10px", margin: "6px 0" }}>
                                  <div
                                    style={{
                                      width: "32px",
                                      height: "32px",
                                      borderRadius: "6px",
                                      background: "#1A1E29",
                                      border: "1px solid #222736",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "14px",
                                      flexShrink: 0
                                    }}
                                  >
                                    🍽️
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: "13px", color: "#F0F0F0", fontWeight: "700" }}>
                                      {it.quantity}x {it.name}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons Footer - EXACTLY TWO ACTIONS IN SEQUENCE */}
                        <div style={{ padding: "0 14px 14px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          {/* Action 1: Start Cooking */}
                          {isPending ? (
                            <button
                              onClick={() => updateOrderStatus(ticket.id, "PREPARING")}
                              style={{
                                height: "40px",
                                background: "#DC2626",
                                color: "#FFFFFF",
                                border: 0,
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer"
                              }}
                            >
                              Start Cooking
                            </button>
                          ) : (
                            <div
                              style={{
                                height: "40px",
                                background: "#1A1E29",
                                border: "1px solid #222736",
                                borderRadius: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "11px",
                                fontWeight: "700",
                                color: isReady ? "#10B981" : "#F59E0B"
                              }}
                            >
                              {isReady ? "Cooked [OK]" : "Cooking..."}
                            </div>
                          )}

                          {/* Action 2: Order Ready */}
                          {isCooking ? (
                            <button
                              onClick={() => updateOrderStatus(ticket.id, "READY")}
                              style={{
                                height: "40px",
                                background: "#10B981",
                                color: "#FFFFFF",
                                border: 0,
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer"
                              }}
                            >
                              Order Ready
                            </button>
                          ) : isReady ? (
                            <div
                              style={{
                                height: "40px",
                                background: "#133526",
                                border: "1px solid #10B981",
                                borderRadius: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "11px",
                                fontWeight: "700",
                                color: "#10B981"
                              }}
                            >
                              Ready [OK]
                            </div>
                          ) : (
                            <div
                              style={{
                                height: "40px",
                                background: "#1A1E29",
                                border: "1px solid #222736",
                                borderRadius: "6px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "11px",
                                fontWeight: "600",
                                color: "#8B949E"
                              }}
                            >
                              Pending Cook
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {/* Kitchen Station Footer Ledger */}
              <div
                style={{
                  marginTop: "16px",
                  padding: "14px 18px",
                  background: "#161B22",
                  borderRadius: "10px",
                  border: "1px solid #222736",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <span style={{ fontSize: "12px", color: "#8B949E", fontWeight: "600" }}>
                  KDS PIPELINE: QUEUED (Pending) &rarr; COOKING (Preparing) &rarr; READY
                </span>
                <span style={{ fontSize: "11px", color: "#10B981", fontWeight: "700" }}>
                  Active Tickets: {kitchenTickets.length}
                </span>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 3: MENU MANAGEMENT (A5, A7) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "menu" && (
            <div>
              {/* Stats Bar */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#8B949E", fontWeight: "700" }}>TOTAL ITEMS</span>
                  <strong style={{ display: "block", fontSize: "22px", color: "#FFF", marginTop: "4px" }}>{allMenuItems.length}</strong>
                </div>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#10B981", fontWeight: "700" }}>IN STOCK</span>
                  <strong style={{ display: "block", fontSize: "22px", color: "#10B981", marginTop: "4px" }}>{inStockCount}</strong>
                </div>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#EF4444", fontWeight: "700" }}>SOLD OUT</span>
                  <strong style={{ display: "block", fontSize: "22px", color: "#EF4444", marginTop: "4px" }}>{soldOutCount}</strong>
                </div>
                <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "8px", padding: "14px" }}>
                  <span style={{ fontSize: "11px", color: "#3B82F6", fontWeight: "700" }}>CATEGORIES</span>
                  <strong style={{ display: "block", fontSize: "22px", color: "#3B82F6", marginTop: "4px" }}>{categories.length}</strong>
                </div>
              </div>

              {/* Actions & Search */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", gap: "10px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Search catalog by name..."
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: "220px",
                    height: "38px",
                    background: "#181818",
                    border: "1px solid #2A2A2A",
                    borderRadius: "6px",
                    padding: "0 12px",
                    color: "#FFF",
                    fontSize: "12px"
                  }}
                />

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={() => setShowCategoryModal(true)}
                    style={{
                      height: "38px",
                      padding: "0 14px",
                      background: "#222736",
                      color: "#FFF",
                      border: 0,
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    + Add Category
                  </button>
                  <button
                    onClick={() => {
                      setEditingItem(null);
                      setItemForm({
                        name: "",
                        price: "",
                        category_id: categories[0]?.id || "",
                        description: "",
                        image_url: "",
                        in_stock: true
                      });
                      setShowItemModal(true);
                    }}
                    style={{
                      height: "38px",
                      padding: "0 16px",
                      background: "#DC2626",
                      color: "#FFF",
                      border: 0,
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: "pointer"
                    }}
                  >
                    + Add Menu Item
                  </button>
                </div>
              </div>

              {/* Categories & Items Accordion */}
              <div style={{ display: "grid", gap: "20px" }}>
                {categories.map((cat) => {
                  const filteredCatItems = cat.menu_items.filter((it) =>
                    !menuSearch.trim() || it.name.toLowerCase().includes(menuSearch.toLowerCase())
                  );

                  return (
                    <div key={cat.id} style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                        <h3 style={{ margin: 0, fontSize: "15px", color: "#FFFFFF", fontWeight: "700" }}>
                          {cat.name} ({filteredCatItems.length})
                        </h3>
                      </div>

                      <div style={{ display: "grid", gap: "8px" }}>
                        {filteredCatItems.map((item) => (
                          <div
                            key={item.id}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              background: "#201F1F",
                              padding: "10px 14px",
                              borderRadius: "8px",
                              gap: "12px"
                            }}
                          >
                            {/* Photo thumbnail with clean fallback (A7) */}
                            <div
                              style={{
                                width: "48px",
                                height: "48px",
                                borderRadius: "6px",
                                background: "#131313",
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
                                <span style={{ fontSize: "10px", color: "#666" }}>NO PIC</span>
                              )}
                            </div>

                            <div style={{ flex: 1 }}>
                              <strong style={{ fontSize: "14px", color: "#FFF" }}>{item.name}</strong>
                              <span style={{ fontSize: "12px", color: "#10B981", display: "block" }}>
                                Rs. {item.price.toLocaleString()}
                              </span>
                            </div>

                            {/* Stock Toggle Switch */}
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              <button
                                onClick={() => toggleItemStock(item.id, item.in_stock)}
                                style={{
                                  padding: "6px 12px",
                                  borderRadius: "6px",
                                  border: 0,
                                  background: item.in_stock ? "#065F46" : "#7F1D1D",
                                  color: "#FFF",
                                  fontSize: "11px",
                                  fontWeight: "800",
                                  cursor: "pointer"
                                }}
                              >
                                {item.in_stock ? "IN STOCK" : "SOLD OUT"}
                              </button>

                              <button
                                onClick={() => {
                                  setEditingItem(item);
                                  setItemForm({
                                    name: item.name,
                                    price: String(item.price),
                                    category_id: item.category_id,
                                    description: item.description || "",
                                    image_url: item.image_url || "",
                                    in_stock: item.in_stock
                                  });
                                  setShowItemModal(true);
                                }}
                                style={{
                                  background: "#2A2A2A",
                                  color: "#FFF",
                                  border: 0,
                                  borderRadius: "6px",
                                  padding: "6px 10px",
                                  fontSize: "11px",
                                  fontWeight: "700",
                                  cursor: "pointer"
                                }}
                              >
                                Edit
                              </button>

                              <button
                                onClick={() => handleDeleteMenuItem(item.id)}
                                style={{
                                  background: "#3F1818",
                                  color: "#EF4444",
                                  border: 0,
                                  borderRadius: "6px",
                                  padding: "6px 10px",
                                  fontSize: "11px",
                                  fontWeight: "700",
                                  cursor: "pointer"
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 4: SPECIAL OFFERS (A6) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "offers" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF" }}>Active Promotions &amp; Special Deals</h3>
                  <p style={{ margin: "2px 0 0 0", color: "#8B949E", fontSize: "12px" }}>
                    Deals render dynamically on customer QR mobile menu with styled badges
                  </p>
                </div>
                <button
                  onClick={() => setShowOfferModal(true)}
                  style={{
                    height: "38px",
                    padding: "0 16px",
                    background: "#DC2626",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "6px",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  + Create Special Offer
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>
                {offers.length === 0 ? (
                  <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "60px 20px", color: "#8B949E" }}>
                    No special promotions configured yet. Click "+ Create Special Offer" above.
                  </div>
                ) : (
                  offers.map((offer) => (
                    <div
                      key={offer.id}
                      style={{
                        background: "#181818",
                        border: "1px solid #DC2626",
                        borderRadius: "10px",
                        padding: "16px",
                        position: "relative"
                      }}
                    >
                      <span
                        style={{
                          background: "#DC2626",
                          color: "#FFF",
                          fontSize: "10px",
                          fontWeight: "800",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          textTransform: "uppercase"
                        }}
                      >
                        {offer.card_style} Style
                      </span>

                      <div style={{ margin: "10px 0" }}>
                        <strong style={{ fontSize: "15px", color: "#FFF", display: "block" }}>
                          {offer.badge_text || "Special Deal"}
                        </strong>
                        <span style={{ fontSize: "13px", color: "#C9D1D9" }}>
                          Linked Item: {offer.item?.name || "Menu Item"}
                        </span>
                        {offer.item && (
                          <span style={{ display: "block", fontSize: "14px", color: "#10B981", fontWeight: "800", marginTop: "4px" }}>
                            Rs. {offer.item.price.toLocaleString()}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: "11px", color: "#8B949E", marginBottom: "12px" }}>
                        Active Days: {offer.days_of_week.map((d) => d.toUpperCase()).join(", ") || "All Days"}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          onClick={() => handleDeleteOffer(offer.id)}
                          style={{
                            background: "#2A2A2A",
                            color: "#EF4444",
                            border: 0,
                            borderRadius: "6px",
                            padding: "6px 12px",
                            fontSize: "11px",
                            fontWeight: "700",
                            cursor: "pointer"
                          }}
                        >
                          Delete Deal
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 5: INVENTORY & VENDOR WHATSAPP DISPATCH (D1) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "inventory" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF" }}>Raw Ingredient Inventory</h3>
                  <p style={{ margin: "2px 0 0 0", color: "#8B949E", fontSize: "12px" }}>
                    Monitor thresholds and dispatch purchase orders to supplier WhatsApp
                  </p>
                </div>
                <button
                  onClick={() => setShowIngredientModal(true)}
                  style={{
                    height: "38px",
                    padding: "0 14px",
                    background: "#DC2626",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "6px",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  + Add Ingredient
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                {ingredients.map((ing) => {
                  const isLow = ing.current_stock <= ing.threshold;
                  const isEditing = quickStockEditId === ing.id;

                  return (
                    <div
                      key={ing.id}
                      style={{
                        background: "#181818",
                        border: isLow ? "1px solid #EF4444" : "1px solid #2A2A2A",
                        padding: "12px 16px",
                        borderRadius: "8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "14px", color: "#FFF" }}>{ing.name}</strong>
                        <span style={{ fontSize: "11px", color: "#8B949E", display: "block" }}>
                          Threshold: {ing.threshold} {ing.unit}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: "4px" }}>
                            <input
                              type="number"
                              value={quickStockVal}
                              onChange={(e) => setQuickStockVal(e.target.value)}
                              style={{ width: "70px", height: "30px", background: "#222", border: "1px solid #444", color: "#FFF", padding: "0 6px", borderRadius: "4px" }}
                            />
                            <button
                              onClick={() => handleQuickStockUpdate(ing.id)}
                              style={{ background: "#10B981", color: "#FFF", border: 0, borderRadius: "4px", padding: "0 8px", fontSize: "11px", fontWeight: "700" }}
                            >
                              Save
                            </button>
                          </div>
                        ) : (
                          <strong
                            onClick={() => {
                              setQuickStockEditId(ing.id);
                              setQuickStockVal(String(ing.current_stock));
                            }}
                            style={{ fontSize: "14px", color: isLow ? "#EF4444" : "#10B981", cursor: "pointer", textDecoration: "underline" }}
                          >
                            {ing.current_stock} {ing.unit}
                          </strong>
                        )}

                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "4px",
                            fontSize: "10px",
                            fontWeight: "800",
                            background: isLow ? "#7F1D1D" : "#065F46",
                            color: "#FFF"
                          }}
                        >
                          {isLow ? "LOW STOCK ALERT" : "OPTIMAL"}
                        </span>

                        {isLow && (
                          <button
                            onClick={() => handleVendorAlert(ing)}
                            style={{
                              background: "#059669",
                              color: "#FFF",
                              border: 0,
                              borderRadius: "6px",
                              padding: "6px 12px",
                              fontSize: "11px",
                              fontWeight: "700",
                              cursor: "pointer"
                            }}
                          >
                            WhatsApp Vendor
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 6: SUPPLIER MARKETPLACE (D2) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "marketplace" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF" }}>Software Provider Supplier Marketplace</h3>
                  <p style={{ margin: "2px 0 0 0", color: "#8B949E", fontSize: "12px" }}>
                    Direct equipment, disposables, and paper rolls supply with WhatsApp ordering
                  </p>
                </div>

                {Object.keys(supplyCart).length > 0 && (
                  <button
                    disabled={marketplaceSubmitting}
                    onClick={submitMarketplaceOrder}
                    style={{
                      height: "38px",
                      padding: "0 18px",
                      background: "#059669",
                      color: "#FFF",
                      border: 0,
                      borderRadius: "6px",
                      fontWeight: "800",
                      fontSize: "12px",
                      cursor: "pointer"
                    }}
                  >
                    {marketplaceSubmitting ? "Submitting..." : `Order Cart via WhatsApp (${Object.values(supplyCart).reduce((a, b) => a + b, 0)} items)`}
                  </button>
                )}
              </div>

              {/* Products Catalog Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
                {supplyProducts.map((prod) => {
                  const qty = supplyCart[prod.id] || 0;

                  return (
                    <div
                      key={prod.id}
                      style={{
                        background: "#181818",
                        border: "1px solid #2A2A2A",
                        borderRadius: "10px",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between"
                      }}
                    >
                      {/* Product Image */}
                      <div style={{ height: "140px", background: "#111", overflow: "hidden" }}>
                        {prod.image_url ? (
                          <img src={prod.image_url} alt={prod.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666", fontSize: "12px" }}>
                            NO IMAGE
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ padding: "14px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                        <div>
                          <span style={{ fontSize: "10px", color: "#DC2626", fontWeight: "800", textTransform: "uppercase" }}>
                            {prod.category}
                          </span>
                          <strong style={{ display: "block", fontSize: "14px", color: "#FFF", margin: "4px 0" }}>
                            {prod.name}
                          </strong>
                          <p style={{ fontSize: "12px", color: "#8B949E", margin: "0 0 10px 0", lineHeight: 1.3 }}>
                            {prod.description}
                          </p>
                        </div>

                        <div>
                          <span style={{ display: "block", fontSize: "14px", color: "#10B981", fontWeight: "800", marginBottom: "8px" }}>
                            {prod.price ? `Rs. ${prod.price.toLocaleString()}` : "Contact for Price"}
                          </span>

                          {/* Cart Add / Stepper */}
                          {qty === 0 ? (
                            <button
                              onClick={() => updateMarketplaceCart(prod.id, 1)}
                              style={{
                                width: "100%",
                                height: "34px",
                                background: "#222736",
                                color: "#FFF",
                                border: 0,
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "700",
                                cursor: "pointer"
                              }}
                            >
                              Add to Stock Cart
                            </button>
                          ) : (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <button
                                onClick={() => updateMarketplaceCart(prod.id, -1)}
                                style={{ width: "32px", height: "32px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "6px", fontWeight: "800" }}
                              >
                                -
                              </button>
                              <strong style={{ flex: 1, textAlign: "center", fontSize: "14px", color: "#FFF" }}>{qty}</strong>
                              <button
                                onClick={() => updateMarketplaceCart(prod.id, 1)}
                                style={{ width: "32px", height: "32px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "6px", fontWeight: "800" }}
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

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 7: TABLE QR CODES */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "qrcodes" && (
            <div style={{ maxWidth: "560px", margin: "0 auto", background: "#181818", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "24px" }}>
              <div style={{ marginBottom: "16px" }}>
                <span style={{ color: "#DC2626", fontSize: "11px", fontWeight: "800" }}>TABLE STANDS</span>
                <h3 style={{ margin: "2px 0 0 0", fontSize: "18px", color: "#FFF" }}>QR Code Stand Generator</h3>
              </div>

              <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
                {["T-01", "T-02", "T-03", "T-04", "T-05"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setSelectedTable(t)}
                    style={{
                      flex: 1,
                      height: "38px",
                      borderRadius: "6px",
                      border: 0,
                      background: selectedTable === t ? "#DC2626" : "#222736",
                      color: "#FFF",
                      fontWeight: "700",
                      fontSize: "12px",
                      cursor: "pointer"
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div style={{ textAlign: "center", background: "#FFFFFF", padding: "20px", borderRadius: "10px", marginBottom: "16px" }}>
                <img src={qrCodeUrl} alt={selectedTable} style={{ width: "220px", height: "220px", margin: "0 auto", display: "block" }} />
                <strong style={{ color: "#111", fontSize: "18px", display: "block", marginTop: "10px" }}>
                  TABLE {selectedTable}
                </strong>
                <span style={{ color: "#666", fontSize: "11px" }}>Scan to open live restaurant menu</span>
              </div>

              <div style={{ background: "#0E0E0E", border: "1px solid #2A2A2A", borderRadius: "6px", padding: "10px", marginBottom: "16px" }}>
                <span style={{ fontSize: "10px", color: "#8B949E", display: "block" }}>TARGET DESTINATION:</span>
                <code style={{ fontSize: "11px", color: "#10B981", wordBreak: "break-all" }}>{qrTargetUrl}</code>
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
                <a
                  href={qrTargetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    height: "38px",
                    padding: "0 16px",
                    background: "#222736",
                    color: "#FFF",
                    borderRadius: "6px",
                    display: "inline-flex",
                    alignItems: "center",
                    textDecoration: "none",
                    fontSize: "12px",
                    fontWeight: "700"
                  }}
                >
                  Test Link
                </a>
                <button
                  onClick={() => window.print()}
                  style={{
                    height: "38px",
                    padding: "0 18px",
                    background: "#DC2626",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "800",
                    cursor: "pointer"
                  }}
                >
                  Print QR Card
                </button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 8: STAFF ACCOUNTS */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "staff" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF" }}>Operator Accounts &amp; PIN Security</h3>
                  <p style={{ margin: "2px 0 0 0", color: "#8B949E", fontSize: "12px" }}>
                    Configure Cashier, Kitchen, and Admin PIN credentials
                  </p>
                </div>
                <button
                  onClick={() => {
                    setStaffForm({ name: "", username: "", role: "cashier", pin: "" });
                    setShowStaffModal(true);
                  }}
                  style={{
                    height: "38px",
                    padding: "0 14px",
                    background: "#DC2626",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "6px",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  + Add Operator
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px" }}>
                {staffList.map((st) => (
                  <div
                    key={st.id}
                    style={{
                      background: "#181818",
                      border: "1px solid #2A2A2A",
                      padding: "12px 16px",
                      borderRadius: "8px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "14px", color: "#FFF" }}>{st.name}</strong>
                      <span style={{ fontSize: "12px", color: "#8B949E", display: "block" }}>
                        @{st.username || st.phone}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span
                        style={{
                          background: "#DC2626",
                          color: "#FFF",
                          fontSize: "10px",
                          fontWeight: "800",
                          padding: "3px 8px",
                          borderRadius: "4px"
                        }}
                      >
                        {st.role.toUpperCase()}
                      </span>
                      <span style={{ color: st.active ? "#10B981" : "#EF4444", fontSize: "11px", fontWeight: "700" }}>
                        {st.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 9: REPORTS & DIAGNOSTICS */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "reports" && (
            <div style={{ maxWidth: "600px" }}>
              <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "20px" }}>
                <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", color: "#FFF" }}>Day-End Reports &amp; Diagnostics</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                  <div style={{ background: "#201F1F", borderRadius: "8px", padding: "14px" }}>
                    <span style={{ fontSize: "11px", color: "#8B949E", fontWeight: "700" }}>TOTAL ORDERS</span>
                    <strong style={{ display: "block", fontSize: "22px", color: "#FFF", marginTop: "4px" }}>
                      {orders.length}
                    </strong>
                  </div>
                  <div style={{ background: "#201F1F", borderRadius: "8px", padding: "14px" }}>
                    <span style={{ fontSize: "11px", color: "#10B981", fontWeight: "700" }}>BRIDGE RUNNING</span>
                    <strong style={{ display: "block", fontSize: "22px", color: "#10B981", marginTop: "4px" }}>
                      127.0.0.1:8765
                    </strong>
                  </div>
                </div>

                <button
                  onClick={() => window.print()}
                  style={{
                    height: "40px",
                    padding: "0 20px",
                    background: "#DC2626",
                    color: "#FFF",
                    border: 0,
                    borderRadius: "6px",
                    fontWeight: "800",
                    fontSize: "12px",
                    cursor: "pointer"
                  }}
                >
                  Generate Daily Z-Report Summary
                </button>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════════════ */}
          {/* TAB 10: SYSTEM SETTINGS (USER-REQUESTED EDITABLE WHATSAPP NUMBERS) */}
          {/* ═════════════════════════════════════════════════════════════════════ */}
          {activeTab === "settings" && (
            <div style={{ maxWidth: "560px" }}>
              <div style={{ background: "#181818", border: "1px solid #2A2A2A", borderRadius: "10px", padding: "24px" }}>
                <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", color: "#FFF" }}>Restaurant &amp; WhatsApp Configuration</h3>
                <p style={{ margin: "0 0 20px 0", color: "#8B949E", fontSize: "12px" }}>
                  Set all target WhatsApp numbers for customer orders, supplier marketplace, and vendor alerts
                </p>

                {settingsNotice && (
                  <div style={{ background: "#065F46", color: "#FFF", padding: "8px 12px", borderRadius: "6px", marginBottom: "14px", fontSize: "12px", fontWeight: "700" }}>
                    {settingsNotice}
                  </div>
                )}

                <form onSubmit={handleSaveSettings} style={{ display: "grid", gap: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                      RESTAURANT BRAND NAME
                    </label>
                    <input
                      type="text"
                      value={settings.brand_name}
                      onChange={(e) => setSettings({ ...settings, brand_name: e.target.value })}
                      style={{ width: "100%", height: "38px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "13px" }}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                      CUSTOMER DELIVERY / PICKUP WHATSAPP NUMBER
                    </label>
                    <input
                      type="text"
                      value={settings.whatsapp_phone}
                      onChange={(e) => setSettings({ ...settings, whatsapp_phone: e.target.value })}
                      placeholder="923XXXXXXXXX"
                      style={{ width: "100%", height: "38px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "13px" }}
                      required
                    />
                    <span style={{ fontSize: "10px", color: "#666" }}>Customer cart wa.me links are sent to this phone.</span>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                      SUPPLIER MARKETPLACE ADMIN WHATSAPP NUMBER (CONFIGURABLE)
                    </label>
                    <input
                      type="text"
                      value={settings.supplier_marketplace_phone}
                      onChange={(e) => setSettings({ ...settings, supplier_marketplace_phone: e.target.value })}
                      placeholder="923XXXXXXXXX"
                      style={{ width: "100%", height: "38px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "13px" }}
                      required
                    />
                    <span style={{ fontSize: "10px", color: "#666" }}>Stock orders from the Marketplace tab are sent to this supplier WhatsApp.</span>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                      LOW STOCK VENDOR ALERT PHONE NUMBER
                    </label>
                    <input
                      type="text"
                      value={settings.notify_low_stock_phone}
                      onChange={(e) => setSettings({ ...settings, notify_low_stock_phone: e.target.value })}
                      placeholder="923XXXXXXXXX"
                      style={{ width: "100%", height: "38px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "13px" }}
                      required
                    />
                    <span style={{ fontSize: "10px", color: "#666" }}>Raw ingredient purchase orders are generated to this vendor phone.</span>
                  </div>

                  <button
                    disabled={settingsSaving}
                    type="submit"
                    style={{
                      height: "40px",
                      background: "#DC2626",
                      color: "#FFF",
                      border: 0,
                      borderRadius: "6px",
                      fontWeight: "800",
                      fontSize: "12px",
                      cursor: "pointer",
                      marginTop: "6px"
                    }}
                  >
                    {settingsSaving ? "Saving..." : "Save Settings"}
                  </button>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: FAST PIN UNLOCK / ROLE SWITCH KEYPAD (A1) */}
      {/* Matching stitch_portfolio_theme_switcher_integration/staff_quick_pin_lock */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showPinModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(8px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "#131313",
              border: "1px solid #2A2A2A",
              borderRadius: "16px",
              padding: "24px",
              boxShadow: "0 20px 40px rgba(0,0,0,0.8)"
            }}
          >
            {/* Header */}
            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "12px",
                  background: "#2A2A2A",
                  margin: "0 auto 10px auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  color: "#DC2626",
                  fontWeight: "900"
                }}
              >
                PIN
              </div>
              <h3 style={{ margin: 0, fontSize: "18px", color: "#FFF", fontWeight: "800" }}>Fast PIN Unlock / Switch</h3>
              <p style={{ margin: "4px 0 0 0", color: "#8B949E", fontSize: "12px" }}>
                Enter operator PIN to unlock terminal or switch role
              </p>
            </div>

            {/* Operator Selection */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" }}>
              <div>
                <label style={{ display: "block", fontSize: "10px", color: "#8B949E", fontWeight: "700", marginBottom: "3px" }}>
                  USERNAME
                </label>
                <input
                  type="text"
                  value={pinUsername}
                  onChange={(e) => setPinUsername(e.target.value)}
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", color: "#FFF", padding: "0 8px", fontSize: "12px" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "10px", color: "#8B949E", fontWeight: "700", marginBottom: "3px" }}>
                  TARGET ROLE
                </label>
                <select
                  value={pinRole}
                  onChange={(e) => setPinRole(e.target.value as typeof pinRole)}
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", color: "#FFF", padding: "0 8px", fontSize: "12px" }}
                >
                  <option value="cashier">Cashier</option>
                  <option value="kitchen">Kitchen / Chef</option>
                  <option value="admin">Manager / Admin</option>
                  <option value="rider">Rider</option>
                </select>
              </div>
            </div>

            {/* Masked PIN Display */}
            <div
              style={{
                height: "50px",
                background: "#0E0E0E",
                border: "1px solid #2A2A2A",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                marginBottom: "12px"
              }}
            >
              {[0, 1, 2, 3].map((idx) => {
                const filled = enteredPin.length > idx;
                return (
                  <span
                    key={idx}
                    style={{
                      width: "12px",
                      height: "12px",
                      borderRadius: "50%",
                      background: filled ? "#DC2626" : "#2A2A2A",
                      transition: "background 0.15s"
                    }}
                  />
                );
              })}
            </div>

            {/* Error state on failure (A1) */}
            {pinError && (
              <div style={{ color: "#EF4444", fontSize: "11px", textAlign: "center", fontWeight: "700", marginBottom: "10px" }}>
                {pinError}
              </div>
            )}

            {/* 3x4 Tactile Keypad */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "16px" }}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLEAR", "0", "BACK"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    if (k === "CLEAR") setEnteredPin("");
                    else if (k === "BACK") setEnteredPin((prev) => prev.slice(0, -1));
                    else if (enteredPin.length < 12) setEnteredPin((prev) => prev + k);
                  }}
                  style={{
                    height: "48px",
                    borderRadius: "8px",
                    background: "#201F1F",
                    color: "#FFF",
                    border: "1px solid #2A2A2A",
                    fontSize: k.length > 1 ? "11px" : "18px",
                    fontWeight: "800",
                    cursor: "pointer"
                  }}
                >
                  {k === "BACK" ? "⌫" : k}
                </button>
              ))}
            </div>

            {/* Unlock Button */}
            <button
              disabled={pinBusy || !enteredPin}
              onClick={() => submitPinLogin()}
              style={{
                width: "100%",
                height: "44px",
                background: "#DC2626",
                color: "#FFF",
                border: 0,
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "800",
                cursor: "pointer",
                marginBottom: "8px"
              }}
            >
              {pinBusy ? "Authenticating..." : "Unlock Terminal"}
            </button>

            <button
              type="button"
              onClick={() => setShowPinModal(false)}
              style={{
                width: "100%",
                height: "36px",
                background: "transparent",
                color: "#8B949E",
                border: 0,
                fontSize: "12px",
                fontWeight: "600",
                cursor: "pointer"
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: ADD / EDIT MENU ITEM (A5, A7) */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showItemModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "500px",
              background: "#131313",
              border: "1px solid #2A2A2A",
              borderRadius: "14px",
              padding: "24px",
              maxHeight: "90vh",
              overflowY: "auto"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF" }}>
                {editingItem ? "Edit Menu Item" : "Add New Menu Item"}
              </h3>
              <button
                onClick={() => setShowItemModal(false)}
                style={{ background: "transparent", border: 0, color: "#8B949E", fontSize: "18px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMenuItem} style={{ display: "grid", gap: "12px" }}>
              {/* Photo Upload with Cloudinary (A5, A7) */}
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                  ITEM PHOTOGRAPHY (CLOUDINARY)
                </label>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    style={{ fontSize: "11px", color: "#8B949E" }}
                  />
                  {photoUploading && <span style={{ fontSize: "11px", color: "#10B981" }}>Uploading...</span>}
                </div>
                {itemForm.image_url && (
                  <div style={{ width: "80px", height: "80px", borderRadius: "6px", overflow: "hidden", marginTop: "8px" }}>
                    <img src={itemForm.image_url} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                  ITEM NAME
                </label>
                <input
                  type="text"
                  value={itemForm.name}
                  onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                  placeholder="e.g. Smoked Prime Brisket"
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                  required
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                    BASE PRICE (RS.)
                  </label>
                  <input
                    type="number"
                    value={itemForm.price}
                    onChange={(e) => setItemForm({ ...itemForm, price: e.target.value })}
                    placeholder="1450"
                    style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                    CATEGORY
                  </label>
                  <select
                    value={itemForm.category_id}
                    onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}
                    style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                  DESCRIPTION
                </label>
                <textarea
                  value={itemForm.description}
                  onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                  placeholder="Tender slow-smoked beef brisket with house BBQ glaze..."
                  rows={3}
                  style={{ width: "100%", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "8px 10px", color: "#FFF", fontSize: "12px" }}
                />
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => setShowItemModal(false)}
                  style={{ height: "36px", padding: "0 16px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ height: "36px", padding: "0 18px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }}
                >
                  Save Menu Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: CREATE SPECIAL OFFER (A6) */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showOfferModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "500px",
              background: "#131313",
              border: "1px solid #2A2A2A",
              borderRadius: "14px",
              padding: "24px"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", color: "#FFF" }}>Create Special Offer / Promo</h3>
              <button
                onClick={() => setShowOfferModal(false)}
                style={{ background: "transparent", border: 0, color: "#8B949E", fontSize: "18px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveOffer} style={{ display: "grid", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                  SELECT ITEM FROM MENU
                </label>
                <select
                  value={offerForm.menu_item_id}
                  onChange={(e) => setOfferForm({ ...offerForm, menu_item_id: e.target.value })}
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", color: "#FFF", padding: "0 8px", fontSize: "12px" }}
                  required
                >
                  <option value="">-- Choose item --</option>
                  {allMenuItems.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} (Rs. {it.price})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                  CARD BADGE / HEADLINE
                </label>
                <input
                  type="text"
                  value={offerForm.badge_text}
                  onChange={(e) => setOfferForm({ ...offerForm, badge_text: e.target.value })}
                  placeholder="e.g. Pitmaster Weekend Special"
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", color: "#FFF", padding: "0 8px", fontSize: "12px" }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11px", color: "#8B949E", fontWeight: "700", marginBottom: "4px" }}>
                  CARD STYLE
                </label>
                <select
                  value={offerForm.card_style}
                  onChange={(e) => setOfferForm({ ...offerForm, card_style: e.target.value as SpecialOffer["card_style"] })}
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", color: "#FFF", padding: "0 8px", fontSize: "12px" }}
                >
                  <option value="flame">Flame Badge (Crimson Red Glow)</option>
                  <option value="gradient">Gradient Glow (Gold Border)</option>
                  <option value="ribbon">Ribbon Tag (Top Right Banner)</option>
                  <option value="countdown">Countdown Timer Style</option>
                  <option value="seasonal_frame">Seasonal Frame (Bold Accent)</option>
                </select>
              </div>

              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => setShowOfferModal(false)}
                  style={{ height: "36px", padding: "0 16px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "12px", fontWeight: "700", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ height: "36px", padding: "0 18px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "12px", fontWeight: "800", cursor: "pointer" }}
                >
                  Publish Special Offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: ADD CATEGORY */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showCategoryModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div style={{ width: "100%", maxWidth: "380px", background: "#131313", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "15px", color: "#FFF" }}>Create Category</h3>
            <form onSubmit={handleCreateCategory} style={{ display: "grid", gap: "10px" }}>
              <input
                type="text"
                placeholder="Category Name (e.g. Desserts)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                required
              />
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(false)}
                  style={{ height: "34px", padding: "0 12px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ height: "34px", padding: "0 14px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "11px", fontWeight: "800" }}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 5: ADD INGREDIENT */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showIngredientModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div style={{ width: "100%", maxWidth: "400px", background: "#131313", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "15px", color: "#FFF" }}>Add Raw Ingredient</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const res = await fetch("/api/admin/inventory", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "save_ingredient",
                      name: ingredientForm.name,
                      unit: ingredientForm.unit,
                      current_stock: Number(ingredientForm.current_stock),
                      threshold: Number(ingredientForm.threshold)
                    })
                  });
                  if (!res.ok) throw new Error("Could not save ingredient.");
                  setShowIngredientModal(false);
                  void loadInventory();
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Error");
                }
              }}
              style={{ display: "grid", gap: "10px" }}
            >
              <input
                type="text"
                placeholder="Ingredient Name (e.g. Prime Beef)"
                value={ingredientForm.name}
                onChange={(e) => setIngredientForm({ ...ingredientForm, name: e.target.value })}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                required
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="Unit (kg, pcs)"
                  value={ingredientForm.unit}
                  onChange={(e) => setIngredientForm({ ...ingredientForm, unit: e.target.value })}
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                  required
                />
                <input
                  type="number"
                  placeholder="Current Stock"
                  value={ingredientForm.current_stock}
                  onChange={(e) => setIngredientForm({ ...ingredientForm, current_stock: e.target.value })}
                  style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                  required
                />
              </div>
              <input
                type="number"
                placeholder="Low Stock Alert Threshold"
                value={ingredientForm.threshold}
                onChange={(e) => setIngredientForm({ ...ingredientForm, threshold: e.target.value })}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                required
              />
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => setShowIngredientModal(false)}
                  style={{ height: "34px", padding: "0 12px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ height: "34px", padding: "0 14px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "11px", fontWeight: "800" }}
                >
                  Add Ingredient
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 6: ADD OPERATOR */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {showStaffModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div style={{ width: "100%", maxWidth: "400px", background: "#131313", border: "1px solid #2A2A2A", borderRadius: "12px", padding: "20px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "15px", color: "#FFF" }}>Add Staff Operator</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const res = await fetch("/api/admin/staff", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(staffForm)
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "Could not save staff.");
                  setShowStaffModal(false);
                  setStaffForm({ name: "", username: "", role: "cashier", pin: "" });
                  setDashboardNotice(`Staff operator ${staffForm.name} created successfully!`);
                  setTimeout(() => setDashboardNotice(""), 3500);
                  void loadStaff();
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Error");
                }
              }}
              style={{ display: "grid", gap: "10px" }}
            >
              <input
                type="text"
                placeholder="Full Name (e.g. John Doe)"
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                required
              />
              <input
                type="text"
                placeholder="Username (e.g. cashier02)"
                value={staffForm.username}
                onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                required
              />
              <select
                value={staffForm.role}
                onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value as StaffMember["role"] })}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
              >
                <option value="cashier">Cashier</option>
                <option value="kitchen">Kitchen / Chef</option>
                <option value="admin">Manager / Admin</option>
                <option value="rider">Rider</option>
              </select>
              <input
                type="password"
                placeholder="PIN / Password"
                value={staffForm.pin}
                onChange={(e) => setStaffForm({ ...staffForm, pin: e.target.value })}
                style={{ width: "100%", height: "36px", background: "#201F1F", border: "1px solid #333", borderRadius: "6px", padding: "0 10px", color: "#FFF", fontSize: "12px" }}
                required
              />
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => setShowStaffModal(false)}
                  style={{ height: "34px", padding: "0 12px", background: "#2A2A2A", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ height: "34px", padding: "0 14px", background: "#DC2626", color: "#FFF", border: 0, borderRadius: "6px", fontSize: "11px", fontWeight: "800" }}
                >
                  Create Operator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Corner Toast Notification for New Orders (auto-dismisses in 5.5s) */}
      {newOrderToast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 9999,
            background: "#161B22",
            border: "1px solid #DC2626",
            borderRadius: "8px",
            padding: "14px 18px",
            boxShadow: "0 6px 24px rgba(0,0,0,0.8)",
            minWidth: "280px",
            maxWidth: "360px",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "12px",
            animation: "fadeIn 0.25s ease-out"
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#DC2626" }} />
              <strong style={{ fontSize: "13px", color: "#FFFFFF" }}>
                NEW ORDER #ORD-{newOrderToast.order_number}
              </strong>
            </div>
            <div style={{ fontSize: "11px", color: "#8B949E" }}>
              {newOrderToast.order_type === "DINE_IN"
                ? `Table ${newOrderToast.table_number || "STAND"}`
                : newOrderToast.customer_name || newOrderToast.order_type} · {newOrderToast.items.length} item(s) · Rs {newOrderToast.total_amount || 0}
            </div>
          </div>
          <button
            onClick={() => setNewOrderToast(null)}
            style={{
              background: "transparent",
              border: 0,
              color: "#8B949E",
              fontSize: "18px",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
