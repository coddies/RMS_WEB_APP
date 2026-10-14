"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Order = {
  id: string;
  order_number: number | string;
  table_id: string | null;
  order_type: "DINE_IN" | "DELIVERY";
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items: { name: string; quantity: number }[];
  created_at: string;
};

type Table = { id: string; table_number: string };

export default function Cashier() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [alertedOrderId, setAlertedOrderId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"orders" | "qrcode">("orders");
  const [selectedTable, setSelectedTable] = useState("1");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrTargetUrl, setQrTargetUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);

  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Set<string>());

  async function enableSound() {
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
      setSoundEnabled(audio.current.state === "running");
    } catch {
      setError("This browser could not enable order sounds. Keep the cashier page open for visual alerts.");
    }
  }

  useEffect(() => {
    let active = true;
    let refreshing = false;

    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch("/api/orders", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load orders.");
        if (!active) return;

        const next = payload.orders as Order[];
        const newOrder = next.find((order) => !seen.current.has(order.id));
        if (newOrder && seen.current.size) {
          setAlertedOrderId(newOrder.id);
          window.setTimeout(() => setAlertedOrderId((current) => current === newOrder.id ? null : current), 1500);
          if (soundEnabled) {
            try {
              const ctx = audio.current;
              if (ctx?.state === "running") {
                const oscillator = ctx.createOscillator();
                const gain = ctx.createGain();
                oscillator.frequency.value = 880;
                gain.gain.value = 0.12;
                oscillator.connect(gain);
                gain.connect(ctx.destination);
                oscillator.start();
                oscillator.stop(ctx.currentTime + 0.18);
              }
            } catch { }
          }
        }
        next.forEach((order) => seen.current.add(order.id));
        setOrders(next);
        setTables(payload.tables || []);
        setError("");
        setReady(true);
      } catch (reason) {
        if (active) {
          setReady(false);
          setError(reason instanceof Error ? reason.message : "Cashier could not connect.");
        }
      } finally {
        refreshing = false;
      }
    }

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [soundEnabled]);

  // Load QR code for table
  useEffect(() => {
    let active = true;
    async function loadQr() {
      setQrLoading(true);
      try {
        const res = await fetch(`/api/qrcode?tenant=demo&table=${encodeURIComponent(selectedTable)}`);
        const json = await res.json();
        if (active && res.ok) {
          setQrDataUrl(json.data_url);
          setQrTargetUrl(json.url);
        }
      } catch { }
      finally { if (active) setQrLoading(false); }
    }
    void loadQr();
    return () => { active = false; };
  }, [selectedTable]);

  const tableNames = new Map(tables.map((table) => [table.id, table.table_number]));

  return (
    <main className="cashier-page">
      <header className="cashier-header">
        <div>
          <p className="eyebrow">IGNITE POS · WEB OPERATIONS</p>
          <h1>Cashier &amp; Orders Terminal</h1>
        </div>
        <div className="cashier-actions">
          <Link href="/admin/menu" className="sound-button" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Menu Management
          </Link>
          <button className={`sound-button ${soundEnabled ? "enabled" : ""}`} onClick={enableSound}>
            {soundEnabled ? "Sound ON" : "Enable Sound"}
          </button>
          <span className={`live-indicator ${ready ? "on" : ""}`}>
            {ready ? "Live · 1s Sync" : "Connecting"}
          </span>
          <form action="/api/auth/logout" method="post">
            <button className="sound-button">Sign out</button>
          </form>
        </div>
      </header>

      {/* TOP SUB-NAVIGATION */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "22px", borderBottom: "1px solid #222736", paddingBottom: "12px" }}>
        <button
          onClick={() => setActiveTab("orders")}
          style={{
            height: "42px",
            padding: "0 18px",
            borderRadius: "6px",
            border: "0",
            fontWeight: "700",
            background: activeTab === "orders" ? "#DC2626" : "#14171F",
            color: activeTab === "orders" ? "#FFFFFF" : "#8B949E",
            cursor: "pointer"
          }}
        >
          Incoming Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab("qrcode")}
          style={{
            height: "42px",
            padding: "0 18px",
            borderRadius: "6px",
            border: "0",
            fontWeight: "700",
            background: activeTab === "qrcode" ? "#DC2626" : "#14171F",
            color: activeTab === "qrcode" ? "#FFFFFF" : "#8B949E",
            cursor: "pointer"
          }}
        >
          Table QR Codes
        </button>
      </div>

      {error && <section className="panel"><p className="error-text">{error}</p></section>}

      {/* ORDERS TAB */}
      {activeTab === "orders" && (
        <>
          {!error && orders.length === 0 && (
            <section className="empty-state">
              <span>⌁</span>
              <h2>Ready for incoming orders</h2>
              <p className="muted">New customer dine-in and WhatsApp delivery orders will appear here instantaneously.</p>
            </section>
          )}

          <div className="order-grid">
            {orders.map((order) => (
              <article className={`order-card ${order.id === alertedOrderId ? "new-order-flash" : ""}`} key={order.id}>
                <div className="order-top">
                  <div>
                    <span className="eyebrow">
                      {order.order_type === "DELIVERY" ? "Delivery" : `Table ${order.table_id ? tableNames.get(order.table_id) ?? "—" : "—"}`}
                    </span>
                    <h2>Order #{order.order_number ?? order.id.slice(0, 6)}</h2>
                  </div>
                  <time>{new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                {order.order_type === "DELIVERY" && (
                  <div className="delivery-order-contact">
                    <strong>{order.customer_name}</strong>
                    {order.customer_phone && <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>}
                    <span>{order.customer_address}</span>
                  </div>
                )}
                <ul>
                  {(order.items ?? []).map((item, i) => (
                    <li key={`${order.id}-${i}`}>
                      <span>{item.name}</span>
                      <strong>× {item.quantity}</strong>
                    </li>
                  ))}
                </ul>
                <span className="pending-pill">Pending Kitchen</span>
              </article>
            ))}
          </div>
        </>
      )}

      {/* TABLE QR CODES TAB */}
      {activeTab === "qrcode" && (
        <section style={{ maxWidth: "680px", margin: "0 auto", background: "#14171F", border: "1px solid #222736", borderRadius: "12px", padding: "26px" }}>
          <div style={{ marginBottom: "20px" }}>
            <span className="eyebrow" style={{ color: "#DC2626" }}>CUSTOMER DINE-IN</span>
            <h2 style={{ margin: "4px 0 8px 0" }}>Generate &amp; Print Table QR Code</h2>
            <p className="muted" style={{ margin: 0, fontSize: "14px" }}>
              Customers scan this QR code on their smartphone to browse the live menu and place orders.
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "20px" }}>
            <label style={{ fontWeight: "600", fontSize: "14px" }}>Select Table:</label>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              style={{
                height: "42px",
                background: "#0A0A0C",
                color: "#F0F0F0",
                border: "1px solid #2C3240",
                borderRadius: "6px",
                padding: "0 14px",
                fontSize: "14px",
                fontWeight: "600"
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 20].map((num) => (
                <option key={num} value={String(num)}>Table {num}</option>
              ))}
            </select>
          </div>

          <div style={{ textAlign: "center", background: "#FFFFFF", padding: "24px", borderRadius: "12px", maxWidth: "340px", margin: "0 auto 20px auto" }}>
            {qrLoading ? (
              <p style={{ color: "#111", padding: "60px 0" }}>Generating QR Code…</p>
            ) : qrDataUrl ? (
              <>
                <img src={qrDataUrl} alt={`Table ${selectedTable} QR Code`} style={{ width: "240px", height: "240px", display: "block", margin: "0 auto" }} />
                <p style={{ color: "#111", fontWeight: "800", fontSize: "18px", margin: "12px 0 0 0" }}>
                  TABLE {selectedTable}
                </p>
                <p style={{ color: "#666", fontSize: "11px", margin: "4px 0 0 0" }}>Scan to order food</p>
              </>
            ) : null}
          </div>

          <div style={{ background: "#0A0A0C", border: "1px solid #222736", borderRadius: "8px", padding: "14px", marginBottom: "20px" }}>
            <span style={{ fontSize: "11px", color: "#8B949E", display: "block", marginBottom: "4px" }}>TARGET ONLINE URL:</span>
            <code style={{ fontSize: "13px", color: "#10B981", wordBreak: "break-all" }}>
              {qrTargetUrl}
            </code>
          </div>

          <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
            <a
              href={qrTargetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="sound-button"
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Open Menu Link
            </a>
            <button
              className="button"
              onClick={() => window.print()}
              style={{ background: "#DC2626" }}
            >
              Print QR Card
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
