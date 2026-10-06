"use client";
import { useEffect, useRef, useState } from "react";
import OfflineCounter from "@/components/OfflineCounter";

type Order = { id: string; order_number: number | string; table_id: string | null; order_type: "DINE_IN" | "DELIVERY"; customer_name: string | null; customer_phone: string | null; customer_address: string | null; items: { name: string; quantity: number }[]; created_at: string };
type Table = { id: string; table_number: string };
export default function Cashier() {
  const [orders, setOrders] = useState<Order[]>([]); const [tables, setTables] = useState<Table[]>([]); const [error, setError] = useState(""); const [ready, setReady] = useState(false); const [soundEnabled, setSoundEnabled] = useState(false); const [alertedOrderId, setAlertedOrderId] = useState<string | null>(null); const audio = useRef<AudioContext | null>(null); const seen = useRef(new Set<string>());
  async function enableSound() { try { audio.current ??= new AudioContext(); await audio.current.resume(); setSoundEnabled(audio.current.state === "running"); } catch { setError("This browser could not enable order sounds. Keep the cashier page open for visual alerts."); } }
  useEffect(() => {
    let active = true; let refreshing = false;
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const response = await fetch("/api/orders", { cache: "no-store" }); const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Could not load orders.");
        if (!active) return;
        const next = payload.orders as Order[]; const newOrder = next.find((order) => !seen.current.has(order.id));
        if (newOrder && seen.current.size) {
          setAlertedOrderId(newOrder.id);
          window.setTimeout(() => setAlertedOrderId((current) => current === newOrder.id ? null : current), 1500);
          if (soundEnabled) { try { const ctx = audio.current; if (ctx?.state === "running") { const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.frequency.value = 880; gain.gain.value = 0.12; oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); oscillator.stop(ctx.currentTime + 0.18); } } catch { /* Visual order updates remain available. */ } }
        }
        next.forEach((order) => seen.current.add(order.id)); setOrders(next); setTables(payload.tables); setError(""); setReady(true);
      } catch (reason) { if (active) { setReady(false); setError(reason instanceof Error ? reason.message : "Cashier could not connect."); } }
      finally { refreshing = false; }
    }
    void refresh(); const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [soundEnabled]);
  const tableNames = new Map(tables.map((table) => [table.id, table.table_number]));
  return <main className="cashier-page"><header className="cashier-header"><div><p className="eyebrow">Restaurant operations</p><h1>Incoming orders</h1></div><div className="cashier-actions"><button className={`sound-button ${soundEnabled ? "enabled" : ""}`} onClick={enableSound}>{soundEnabled ? "Sound on" : "Enable sound"}</button><span className={`live-indicator ${ready ? "on" : ""}`}>{ready ? "Live · 1 sec refresh" : "Connecting"}</span><form action="/api/auth/logout" method="post"><button className="sound-button">Sign out</button></form></div></header><OfflineCounter />{error && <section className="panel"><p className="error-text">{error}</p></section>}{!error && orders.length === 0 && <section className="empty-state"><span>⌁</span><h2>Ready for the next order</h2><p className="muted">New dine-in and delivery orders will appear here with an alert.</p></section>}<div className="order-grid">{orders.map((order) => <article className={`order-card ${order.id === alertedOrderId ? "new-order-flash" : ""}`} key={order.id}><div className="order-top"><div><span className="eyebrow">{order.order_type === "DELIVERY" ? "Delivery" : `Table ${order.table_id ? tableNames.get(order.table_id) ?? "—" : "—"}`}</span><h2>Order #{order.order_number ?? order.id.slice(0, 6)}</h2></div><time>{new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>{order.order_type === "DELIVERY" && <div className="delivery-order-contact"><strong>{order.customer_name}</strong>{order.customer_phone && <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>}<span>{order.customer_address}</span></div>}<ul>{(order.items ?? []).map((item, i) => <li key={`${order.id}-${i}`}><span>{item.name}</span><strong>× {item.quantity}</strong></li>)}</ul><span className="pending-pill">Pending</span></article>)}</div></main>;
}
