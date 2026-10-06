"use client";

import { useCallback, useEffect, useState } from "react";

type MenuItem = { id: string; name: string; price: number; category_name: string; in_stock: number };
type QueuedOrder = {
  client_order_id: string;
  sequence_no: number;
  order_type: "DINE_IN" | "DELIVERY";
  table_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  items: { item_id: string; name: string; quantity: number; price_at_order: number }[];
  total_amount: number;
  created_at: string;
};

const bridge = "http://127.0.0.1:8765";

export default function OfflineCounter() {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [pending, setPending] = useState<QueuedOrder[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [table, setTable] = useState("");
  const [status, setStatus] = useState("Pair this counter with the local bridge to load its menu cache.");
  const [busy, setBusy] = useState(false);

  const localRequest = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${bridge}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-RMS-Bridge-Token": token, ...init.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Local bridge returned ${response.status}.`);
    return body;
  }, [token]);

  const loadCache = useCallback(async () => {
    if (!token) return;
    try {
      const result = await localRequest("/menu/refresh", { method: "POST", body: "{}" });
      const cached = await localRequest("/menu");
      setItems(cached.items || []);
      setStatus(`Menu refreshed: ${result.cached_items} items. Offline orders stay on this counter until synced.`);
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Could not refresh the local menu."); }
  }, [localRequest, token]);

  const syncPending = useCallback(async () => {
    if (!token) return;
    try {
      const queued = await localRequest("/orders/pending");
      const orders = queued.orders as QueuedOrder[];
      setPending(orders);
      if (!navigator.onLine || !orders.length) return;
      const response = await fetch("/api/offline/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Cloud sync failed.");
      await localRequest("/orders/mark-synced", { method: "POST", body: JSON.stringify({ synced: result.synced }) });
      setPending([]);
      setStatus(`${result.synced.length} offline order${result.synced.length === 1 ? "" : "s"} synced in sequence.`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Orders remain queued until the connection is restored.");
    }
  }, [localRequest, token]);

  useEffect(() => {
    const saved = sessionStorage.getItem("rms_local_bridge_token") || "";
    if (saved) { setToken(saved); setTokenInput(saved); }
  }, []);
  useEffect(() => {
    if (!token) return;
    void localRequest("/menu").then((result) => setItems(result.items || [])).catch((reason) => setStatus(reason instanceof Error ? reason.message : "Bridge is unavailable."));
    if (navigator.onLine) void loadCache();
    void syncPending();
    const timer = window.setInterval(() => { void syncPending(); }, 8000);
    const menuTimer = window.setInterval(() => { if (navigator.onLine) void loadCache(); }, 5 * 60 * 1000);
    const reconnect = () => { void loadCache(); void syncPending(); };
    window.addEventListener("online", reconnect);
    return () => { window.clearInterval(timer); window.clearInterval(menuTimer); window.removeEventListener("online", reconnect); };
  }, [loadCache, localRequest, syncPending, token]);

  function pair(event: React.FormEvent) {
    event.preventDefault();
    const value = tokenInput.trim();
    if (value.length < 32) { setStatus("The bridge key must contain at least 32 characters."); return; }
    sessionStorage.setItem("rms_local_bridge_token", value);
    setToken(value);
    setStatus("Bridge paired. Refresh the menu while online before starting an offline session.");
  }

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    const selected = Object.entries(cart).filter(([, quantity]) => quantity > 0).map(([item_id, quantity]) => ({ item_id, quantity }));
    if (!selected.length) { setStatus("Add at least one menu item."); return; }
    if (!table.trim()) { setStatus("Enter the table number for this counter order."); return; }
    setBusy(true);
    try {
      const saved = await localRequest("/orders", { method: "POST", body: JSON.stringify({ client_order_id: crypto.randomUUID(), order_type: "DINE_IN", table_number: table.trim(), items: selected }) });
      setCart({});
      setStatus(`Order queued locally as #${saved.sequence_no}. Printing and cloud sync will continue when available.`);
      try { await localRequest("/print", { method: "POST", body: JSON.stringify(saved) }); }
      catch (reason) { setStatus(`Order #${saved.sequence_no} is safely queued. Print is unavailable: ${reason instanceof Error ? reason.message : "printer error"}`); }
      void syncPending();
    } catch (reason) { setStatus(reason instanceof Error ? reason.message : "Order could not be saved to the local queue."); }
    finally { setBusy(false); }
  }

  const cartTotal = items.reduce((total, item) => total + Number(item.price) * (cart[item.id] || 0), 0);
  return <section className="offline-counter panel">
    <header className="offline-counter-header"><div><p className="eyebrow">Local counter</p><h2>Offline orders &amp; printing</h2></div><span className={`live-indicator ${token ? "on" : ""}`}>{token ? `${pending.length} pending` : "Bridge not paired"}</span></header>
    {!token ? <form className="offline-pair-form" onSubmit={pair}><label>Local bridge pairing key<input value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} autoComplete="off" minLength={32} required /></label><button className="primary-button" type="submit">Pair counter</button></form> : <>
      <div className="offline-counter-controls"><button className="sound-button" onClick={loadCache} disabled={busy}>Refresh menu cache</button><label>Table<input value={table} onChange={(event) => setTable(event.target.value)} placeholder="e.g. 4" /></label><button className="sound-button" onClick={() => { sessionStorage.removeItem("rms_local_bridge_token"); setToken(""); setTokenInput(""); }}>Unpair</button></div>
      {!items.length ? <p className="muted">No cached menu yet. Connect online and refresh the menu before going offline.</p> : <form onSubmit={submitOrder}>
        <div className="offline-menu-grid">{items.map((item) => <article key={item.id} className="offline-menu-item"><div><strong>{item.name}</strong><span>{item.category_name} · Rs {Number(item.price).toFixed(2)}</span></div><div className="quantity-stepper"><button type="button" aria-label={`Remove one ${item.name}`} onClick={() => setCart((current) => ({ ...current, [item.id]: Math.max(0, (current[item.id] || 0) - 1) }))}>−</button><span>{cart[item.id] || 0}</span><button type="button" aria-label={`Add one ${item.name}`} disabled={!item.in_stock} onClick={() => setCart((current) => ({ ...current, [item.id]: Math.min(99, (current[item.id] || 0) + 1) }))}>+</button></div></article>)}</div>
        <footer className="offline-order-footer"><strong>Total: Rs {cartTotal.toFixed(2)}</strong><button className="primary-button" type="submit" disabled={busy || !items.length}>Save &amp; print order</button></footer>
      </form>}
    </>}
    <p className="offline-counter-status" role="status">{status}</p>
  </section>;
}
