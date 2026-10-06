"use client";
import { useEffect, useState } from "react";

type Ticket = { order_id: string; order_number: number; table_number: string | null; status: string; created_at: string; items: { name: string; quantity: number }[] };
type Delivery = { order_id: string; order_number: number; customer_name: string | null; customer_phone: string | null; customer_address: string | null; status: string; created_at: string; items: { name: string; quantity: number }[] };
export default function RoleWorkView({ role }: { role: "kitchen" | "rider" }) {
  const [rows, setRows] = useState<(Ticket | Delivery)[]>([]); const [error, setError] = useState("");
  useEffect(() => {
    let active = true; const endpoint = role === "kitchen" ? "/api/staff/kitchen-tickets" : "/api/staff/rider-deliveries";
    async function load() {
      try { const response = await fetch(endpoint, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Could not load your work."); if (active) setRows(role === "kitchen" ? body.tickets : body.deliveries); }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Could not load your work."); }
    }
    void load(); const timer = window.setInterval(() => { void load(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [role]);
  return <section className="role-work"><header><p className="eyebrow">{role === "kitchen" ? "Kitchen tickets" : "My assigned deliveries"}</p><h2>{role === "kitchen" ? "Now preparing" : "My deliveries"}</h2></header>{error && <p className="inline-error" role="alert">{error}</p>}{!error && rows.length === 0 && <p className="muted">{role === "kitchen" ? "No active kitchen tickets." : "No deliveries are assigned to you."}</p>}<div className="role-work-list">{rows.map((row) => role === "kitchen" ? <article className="role-work-card" key={row.order_id}><div><strong>Order #{row.order_number}</strong><span>{"table_number" in row ? `Table ${row.table_number ?? "—"}` : ""} · {row.status}</span></div><ul>{row.items.map((item, i) => <li key={`${row.order_id}-${i}`}>{item.name} <b>× {item.quantity}</b></li>)}</ul></article> : <article className="role-work-card" key={row.order_id}><div><strong>Delivery #{row.order_number}</strong><span>{row.status}</span></div>{"customer_name" in row && <p>{row.customer_name ?? "Customer"} {row.customer_phone && <a href={`tel:${row.customer_phone}`}>{row.customer_phone}</a>}</p>}{"customer_address" in row && row.customer_address && <p>{row.customer_address}</p>}<ul>{row.items.map((item, i) => <li key={`${row.order_id}-${i}`}>{item.name} <b>× {item.quantity}</b></li>)}</ul></article>)}</div></section>;
}
