import { createServer } from "node:http";
import { createConnection } from "node:net";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const installRoot = process.env.RMS_COUNTER_INSTALL_ROOT || root;
loadEnv(resolve(installRoot, ".env"));
loadEnv(resolve(installRoot, "..", ".env.local"));
if (installRoot !== root) {
  loadEnv(resolve(root, ".env"));
  loadEnv(resolve(root, "..", ".env.local"));
}

const config = {
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  port: Number(process.env.BRIDGE_PORT || 8765),
  token: process.env.BRIDGE_TOKEN || "",
  sessionEncryptionKey: process.env.BRIDGE_SESSION_ENCRYPTION_KEY || "",
  database: resolve(root, process.env.BRIDGE_DATABASE || "data/restaurant.sqlite"),
  supabaseUrl: (process.env.RMS_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseKey: process.env.RMS_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
  supabaseSecretKey: process.env.RMS_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || "",
  webAppUrl: (process.env.RMS_WEB_APP_URL || "").replace(/\/$/, ""),
  tenantSlug: process.env.RMS_TENANT_SLUG || "",
  printerHost: process.env.PRINTER_HOST || "",
  printerPort: Number(process.env.PRINTER_PORT || 9100),
  printerName: process.env.PRINTER_NAME || "",
};

if (!config.token || config.token.length < 32) {
  const hint = config.token ? `(length ${config.token.length}, need ≥32)` : "(empty — .env not found or BRIDGE_TOKEN not set)";
  process.stderr.write(`[RMS] FATAL: BRIDGE_TOKEN missing or too short ${hint}.\n  Install path: ${installRoot}\n  .env expected at: ${resolve(installRoot, ".env")}\n`);
  process.exit(1);
}

mkdirSync(dirname(config.database), { recursive: true });
const db = new DatabaseSync(config.database);
let usbWorker;
let usbOutput = "";
let usbReadyPromise = Promise.resolve();
const usbRequests = [];
let syncRunning = false;
let staffSyncRunning = false;
if (config.printerName) startUsbWorker();

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS menu_cache (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL,
    category_id TEXT, category_name TEXT, image_url TEXT, in_stock INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO sync_state(key, value) VALUES ('sequence', '0');
  CREATE TABLE IF NOT EXISTS offline_orders (
    client_order_id TEXT PRIMARY KEY, sequence_no INTEGER NOT NULL UNIQUE,
    table_number TEXT, order_type TEXT NOT NULL, customer_name TEXT,
    customer_phone TEXT, customer_address TEXT, items_json TEXT NOT NULL,
    total_amount REAL NOT NULL, sync_status TEXT NOT NULL DEFAULT 'PENDING',
    counter_status TEXT NOT NULL DEFAULT 'PENDING', payment_status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL, synced_at TEXT, cloud_order_id TEXT,
    staff_id TEXT, staff_name TEXT
  );
  CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY, client_order_id TEXT, payload TEXT NOT NULL,
    status TEXT NOT NULL, elapsed_ms INTEGER, error TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'kitchen')),
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cloud_synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS staff_sync_queue (
    id TEXT PRIMARY KEY,
    staff_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('UPSERT', 'DELETE')),
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    synced_at TEXT,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    synced_at TEXT,
    error TEXT
  );
`);

for (const [column, definition] of [
  ["counter_status", "TEXT NOT NULL DEFAULT 'PENDING'"],
  ["payment_status", "TEXT NOT NULL DEFAULT 'PENDING'"],
  ["staff_id", "TEXT"],
  ["staff_name", "TEXT"]
]) {
  if (!db.prepare("PRAGMA table_info(offline_orders)").all().some((row) => row.name === column)) {
    db.exec(`ALTER TABLE offline_orders ADD COLUMN ${column} ${definition}`);
  }
}

function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pin, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPin(storedHash, suppliedPin) {
  if (!storedHash || typeof storedHash !== "string" || !suppliedPin) return false;
  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length === 3) {
      const [, salt, expected] = parts;
      const actual = scryptSync(suppliedPin, salt, 64).toString("hex");
      const bActual = Buffer.from(actual, "hex");
      const bExpected = Buffer.from(expected, "hex");
      return bActual.length === bExpected.length && timingSafeEqual(bActual, bExpected);
    }
  }
  if (storedHash.includes(":")) {
    const [salt, expected] = storedHash.split(":");
    const bExpected = Buffer.from(expected, "hex");
    const bActual = scryptSync(suppliedPin, salt, bExpected.length);
    return bActual.length === bExpected.length && timingSafeEqual(bActual, bExpected);
  }
  return false;
}

const server = createServer(async (request, response) => {
  const startedAt = performance.now();
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-RMS-Bridge-Token");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") return send(response, 204, null);
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        ok: true,
        sqlite: true,
        pending_orders: db.prepare("SELECT COUNT(*) AS count FROM offline_orders WHERE sync_status = 'PENDING'").get().count,
        pending_staff: db.prepare("SELECT COUNT(*) AS count FROM staff_sync_queue WHERE status = 'PENDING'").get().count,
        staff_count: db.prepare("SELECT COUNT(*) AS count FROM staff WHERE active = 1").get().count,
      });
    }

    if (!authorized(request)) return send(response, 401, { error: "Local bridge token is missing or invalid." });

    // ── Local Authentication Endpoints ──────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/counter/auth/bootstrap-status") {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role IN ('admin', 'manager') AND active = 1").get().count;
      const totalCount = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE active = 1").get().count;
      return send(response, 200, {
        needs_bootstrap: adminCount === 0,
        admin_count: adminCount,
        staff_count: totalCount,
        tenant_slug: config.tenantSlug
      });
    }

    if (request.method === "POST" && url.pathname === "/counter/auth/bootstrap") {
      const body = await readJson(request);
      const name = String(body.name || "").trim();
      const username = String(body.username || "").trim();
      const pin = String(body.pin || "").trim();
      const role = String(body.role || "admin").trim().toLowerCase();
      if (!name || !username || !pin) throw new Error("Name, username, and PIN are required.");
      if (pin.length < 4 || pin.length > 32) throw new Error("PIN must be between 4 and 32 characters.");
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role IN ('admin', 'manager') AND active = 1").get().count;
      if (adminCount > 0) throw new Error("An Administrator account already exists. Sign in as Admin to manage staff.");
      const id = randomUUID();
      const now = new Date().toISOString();
      const pin_hash = hashPin(pin);
      transact(() => {
        db.prepare(`INSERT INTO staff(id, username, pin_hash, role, name, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(id, username, pin_hash, role, name, now, now);
        db.prepare(`INSERT INTO staff_sync_queue(id, staff_id, action, payload, status, created_at)
          VALUES (?, ?, 'UPSERT', ?, 'PENDING', ?)`).run(
            randomUUID(), id, JSON.stringify({ id, username, name, role, pin_hash, active: 1 }), now
          );
      });
      queueMicrotask(() => syncStaffToCloud().catch(console.error));
      return send(response, 201, { ok: true, staff: { id, username, name, role } });
    }

    if (request.method === "POST" && url.pathname === "/counter/auth/login") {
      const body = await readJson(request);
      const username = String(body.username || "").trim();
      const pin = String(body.pin || "").trim();
      const requestedRole = String(body.role || "").trim().toLowerCase();
      if (!username || !pin) throw new Error("Enter username and PIN.");
      const user = db.prepare("SELECT * FROM staff WHERE LOWER(username) = LOWER(?) AND active = 1").get(username);
      if (!user || !verifyPin(user.pin_hash, pin)) {
        return send(response, 401, { error: "Username or PIN is incorrect, or account is inactive." });
      }
      if (requestedRole) {
        if (requestedRole === "admin" && !["admin", "manager"].includes(user.role)) {
          return send(response, 403, { error: "This staff account does not have Admin access." });
        }
        if (requestedRole === "cashier" && !["admin", "manager", "cashier"].includes(user.role)) {
          return send(response, 403, { error: "This staff account does not have Cashier access." });
        }
        if (requestedRole === "kitchen" && !["admin", "manager", "kitchen"].includes(user.role)) {
          return send(response, 403, { error: "This staff account does not have Kitchen access." });
        }
      }
      const effectiveRole = requestedRole || user.role;
      const sessionData = {
        id: user.id,
        name: user.name,
        username: user.username,
        role: effectiveRole,
        actual_role: user.role,
        tenant_slug: config.tenantSlug,
        logged_in_at: Date.now()
      };
      if (config.sessionEncryptionKey) {
        db.prepare("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .run(`counter_session_${effectiveRole}`, encryptSession(sessionData));
      }
      return send(response, 200, { ok: true, user: sessionData });
    }

    // ── Staff Management Endpoints ──────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/counter/staff") {
      const rows = db.prepare("SELECT id, username, name, role, active, created_at, updated_at, cloud_synced_at FROM staff ORDER BY name").all();
      return send(response, 200, { staff: rows });
    }

    if (request.method === "POST" && url.pathname === "/counter/staff") {
      const body = await readJson(request);
      const name = String(body.name || "").trim();
      const username = String(body.username || "").trim();
      const role = String(body.role || "cashier").trim().toLowerCase();
      const pin = body.pin ? String(body.pin).trim() : "";
      const active = body.active === undefined ? 1 : (body.active ? 1 : 0);
      if (!name || !username) throw new Error("Name and username are required.");
      if (!["admin", "manager", "cashier", "kitchen"].includes(role)) throw new Error("Role must be admin, cashier, or kitchen.");
      const existing = body.id ? db.prepare("SELECT * FROM staff WHERE id = ?").get(body.id) : null;
      const now = new Date().toISOString();
      let staffId = body.id;
      let pin_hash = existing?.pin_hash || "";
      if (pin) {
        if (pin.length < 4 || pin.length > 32) throw new Error("PIN must be between 4 and 32 characters.");
        pin_hash = hashPin(pin);
      } else if (!existing) {
        throw new Error("A PIN is required for new staff accounts.");
      }
      transact(() => {
        if (existing) {
          db.prepare(`UPDATE staff SET name=?, username=?, role=?, pin_hash=?, active=?, updated_at=? WHERE id=?`)
            .run(name, username, role, pin_hash, active, now, staffId);
        } else {
          staffId = randomUUID();
          const usernameExists = db.prepare("SELECT id FROM staff WHERE LOWER(username) = LOWER(?)").get(username);
          if (usernameExists) throw new Error(`Username '${username}' is already in use.`);
          db.prepare(`INSERT INTO staff(id, username, pin_hash, role, name, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(staffId, username, pin_hash, role, name, active, now, now);
        }
        db.prepare(`INSERT INTO staff_sync_queue(id, staff_id, action, payload, status, created_at)
          VALUES (?, ?, 'UPSERT', ?, 'PENDING', ?)`).run(
            randomUUID(), staffId, JSON.stringify({ id: staffId, username, name, role, pin_hash, active }), now
          );
      });
      queueMicrotask(() => syncStaffToCloud().catch(console.error));
      return send(response, existing ? 200 : 201, {
        ok: true,
        staff: { id: staffId, name, username, role, active, updated_at: now }
      });
    }

    if (request.method === "POST" && url.pathname === "/counter/staff/delete") {
      const body = await readJson(request);
      if (!body.id) throw new Error("Staff ID is required.");
      const staffMember = db.prepare("SELECT * FROM staff WHERE id = ?").get(body.id);
      if (!staffMember) return send(response, 404, { error: "Staff member not found." });
      if (["admin", "manager"].includes(staffMember.role)) {
        const adminCount = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role IN ('admin', 'manager') AND active = 1 AND id != ?").get(body.id).count;
        if (adminCount === 0) throw new Error("Cannot delete or deactivate the last remaining administrator.");
      }
      const now = new Date().toISOString();
      transact(() => {
        db.prepare("UPDATE staff SET active = 0, updated_at = ? WHERE id = ?").run(now, body.id);
        db.prepare(`INSERT INTO staff_sync_queue(id, staff_id, action, payload, status, created_at)
          VALUES (?, ?, 'DELETE', ?, 'PENDING', ?)`).run(
            randomUUID(), body.id, JSON.stringify({ id: body.id, username: staffMember.username }), now
          );
      });
      queueMicrotask(() => syncStaffToCloud().catch(console.error));
      return send(response, 200, { ok: true, id: body.id, deactivated: true });
    }

    // ── Menu and State Endpoints ────────────────────────────────────────────────
    if (request.method === "POST" && url.pathname === "/menu/refresh") return send(response, 200, await refreshMenuCache());
    if (request.method === "GET" && url.pathname === "/menu") {
      return send(response, 200, { items: db.prepare("SELECT id,name,price,category_id,category_name,image_url,in_stock FROM menu_cache ORDER BY category_name,name").all() });
    }
    if (request.method === "GET" && url.pathname === "/counter/menu/catalog") {
      const items = db.prepare("SELECT id,name,price,category_id,category_name,image_url,in_stock FROM menu_cache ORDER BY category_name,name").all();
      const inStockCount = items.filter((i) => i.in_stock).length;
      return send(response, 200, {
        items,
        total: items.length,
        in_stock: inStockCount,
        sold_out: items.length - inStockCount
      });
    }
    if (request.method === "POST" && url.pathname === "/counter/menu/stock") {
      const body = await readJson(request);
      if (!body || !body.id) throw new Error("Item ID is required.");
      const inStock = body.in_stock ? 1 : 0;
      db.prepare("UPDATE menu_cache SET in_stock=? WHERE id=?").run(inStock, body.id);
      queueMicrotask(async () => {
        try {
          const tenantId = await getTenantId();
          const key = config.supabaseSecretKey || config.supabaseKey;
          if (tenantId && key && config.supabaseUrl) {
            await fetch(`${config.supabaseUrl}/rest/v1/menu_items?id=eq.${encodeURIComponent(body.id)}&tenant_id=eq.${tenantId}`, {
              method: "PATCH",
              headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({ in_stock: Boolean(body.in_stock) }),
              signal: AbortSignal.timeout(6000)
            });
          }
        } catch {}
      });
      return send(response, 200, { ok: true, id: body.id, in_stock: Boolean(body.in_stock) });
    }
    if (request.method === "POST" && url.pathname === "/counter/menu/item") {
      const body = await readJson(request);
      if (!body || !body.name || !body.price) throw new Error("Item name and price are required.");
      const id = body.id || randomUUID();
      const price = Number(body.price);
      const categoryName = (body.category_name || "General").trim();
      const inStock = body.in_stock === false ? 0 : 1;
      const now = new Date().toISOString();
      db.prepare("INSERT INTO menu_cache(id,name,price,category_id,category_name,image_url,in_stock,synced_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,category_name=excluded.category_name,in_stock=excluded.in_stock,synced_at=excluded.synced_at")
        .run(id, body.name.trim(), price, body.category_id || id, categoryName, body.image_url || null, inStock, now);
      queueMicrotask(async () => {
        try {
          const tenantId = await getTenantId();
          const key = config.supabaseSecretKey || config.supabaseKey;
          if (tenantId && key && config.supabaseUrl) {
            let catId = body.category_id;
            if (!catId) {
              const catRes = await fetch(`${config.supabaseUrl}/rest/v1/menu_categories?tenant_id=eq.${tenantId}&name=eq.${encodeURIComponent(categoryName)}&limit=1`, {
                headers: { apikey: key, Authorization: `Bearer ${key}` }
              });
              const cats = await catRes.json();
              if (cats?.[0]?.id) {
                catId = cats[0].id;
              } else {
                const newCatRes = await fetch(`${config.supabaseUrl}/rest/v1/menu_categories`, {
                  method: "POST",
                  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
                  body: JSON.stringify({ tenant_id: tenantId, name: categoryName, sort_order: 0 })
                });
                const newCats = await newCatRes.json();
                catId = newCats?.[0]?.id;
              }
            }
            if (catId) {
              await fetch(`${config.supabaseUrl}/rest/v1/menu_items`, {
                method: "POST",
                headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
                body: JSON.stringify({
                  id,
                  tenant_id: tenantId,
                  category_id: catId,
                  name: body.name.trim(),
                  price,
                  description: body.description || null,
                  in_stock: Boolean(inStock),
                  image_url: body.image_url || null
                }),
                signal: AbortSignal.timeout(8000)
              });
            }
          }
        } catch {}
      });
      return send(response, 200, { ok: true, id, name: body.name.trim(), price, in_stock: Boolean(inStock) });
    }
    if (request.method === "POST" && url.pathname === "/counter/menu/delete") {
      const body = await readJson(request);
      if (!body || !body.id) throw new Error("Item ID is required.");
      db.prepare("DELETE FROM menu_cache WHERE id=?").run(body.id);
      queueMicrotask(async () => {
        try {
          const tenantId = await getTenantId();
          const key = config.supabaseSecretKey || config.supabaseKey;
          if (tenantId && key && config.supabaseUrl) {
            await fetch(`${config.supabaseUrl}/rest/v1/menu_items?id=eq.${encodeURIComponent(body.id)}&tenant_id=eq.${tenantId}`, {
              method: "DELETE",
              headers: { apikey: key, Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(6000)
            });
          }
        } catch {}
      });
      return send(response, 200, { ok: true, id: body.id, deleted: true });
    }
    if (request.method === "GET" && url.pathname === "/counter/state") {
      const items = db.prepare("SELECT id,name,price,category_id,category_name,image_url,in_stock FROM menu_cache ORDER BY category_name,name").all();
      const orders = db.prepare("SELECT * FROM offline_orders ORDER BY sequence_no DESC LIMIT 200").all().map(formatOrder);
      const role = url.searchParams.get("role");
      const remote = new Set(["cashier", "kitchen"]).has(role) ? db.prepare("SELECT value FROM sync_state WHERE key=?").get(`counter_remote_data_${role}`) : null;
      return send(response, 200, { tenant_slug: config.tenantSlug, web_app_url: config.webAppUrl, items, orders, remote_orders: remote ? JSON.parse(remote.value) : [], pending_orders: orders.filter((order) => order.sync_status === "PENDING").length });
    }

    // ── Session Endpoints (Pure Local Sessions Supported) ──────────────────────
    if (request.method === "POST" && url.pathname === "/counter/session") {
      const body = await readJson(request);
      if (!body || !body.role) throw new Error("A valid role is required for the session.");
      const value = encryptSession(body);
      db.prepare("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`counter_session_${body.role}`, value);
      return send(response, 200, { accepted: true, role: body.role });
    }

    if (request.method === "GET" && url.pathname === "/counter/staff-access") {
      const role = url.searchParams.get("role");
      if (!new Set(["admin", "cashier", "kitchen"]).has(role)) return send(response, 400, { error: "A valid role is required." });
      const saved = db.prepare("SELECT value FROM sync_state WHERE key=?").get(`counter_session_${role}`);
      if (!saved) return send(response, 404, { error: "No Counter staff session is linked." });
      const session = decryptSession(saved.value);
      return send(response, 200, { role: session.role, name: session.name, username: session.username, user_id: session.id });
    }

    // ── Orders and Printing ─────────────────────────────────────────────────────
    if (request.method === "POST" && url.pathname === "/counter/orders/status") {
      const body = await readJson(request);
      if (typeof body.client_order_id !== "string") throw new Error("A local order id is required.");
      if (body.counter_status !== undefined && !new Set(["PENDING", "PREPARING", "READY", "COMPLETED", "CANCELLED"]).has(body.counter_status)) throw new Error("Invalid kitchen order status.");
      if (body.payment_status !== undefined && !new Set(["PENDING", "PAID"]).has(body.payment_status)) throw new Error("Invalid payment status.");
      const row = db.prepare("SELECT * FROM offline_orders WHERE client_order_id=?").get(body.client_order_id);
      if (!row) return send(response, 404, { error: "Local order was not found." });
      db.prepare("UPDATE offline_orders SET counter_status=COALESCE(?,counter_status),payment_status=COALESCE(?,payment_status) WHERE client_order_id=?")
        .run(body.counter_status ?? null, body.payment_status ?? null, body.client_order_id);
      return send(response, 200, formatOrder(db.prepare("SELECT * FROM offline_orders WHERE client_order_id=?").get(body.client_order_id)));
    }

    if (request.method === "POST" && url.pathname === "/orders") {
      const body = await readJson(request);
      const order = normalizeOrder(body);
      const existing = db.prepare("SELECT * FROM offline_orders WHERE client_order_id=?").get(order.client_order_id);
      if (existing) return send(response, 200, { ...formatOrder(existing), duplicate_submission: true });
      const sequence = db.prepare("SELECT CAST(value AS INTEGER) AS value FROM sync_state WHERE key='sequence'").get().value + 1;
      transact(() => {
        db.prepare("UPDATE sync_state SET value=? WHERE key='sequence'").run(String(sequence));
        db.prepare(`INSERT INTO offline_orders(client_order_id,sequence_no,table_number,order_type,customer_name,customer_phone,customer_address,items_json,total_amount,created_at,staff_id,staff_name)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.client_order_id, sequence, order.table_number, order.order_type, order.customer_name, order.customer_phone, order.customer_address, JSON.stringify(order.items), order.total_amount, new Date().toISOString(), order.staff_id || null, order.staff_name || null);
      });
      queueMicrotask(() => syncCounter().catch(console.error));
      return send(response, 201, { ...order, sequence_no: sequence, sync_status: "PENDING" });
    }

    if (request.method === "GET" && url.pathname === "/orders/pending") {
      const orders = db.prepare("SELECT * FROM offline_orders WHERE sync_status='PENDING' ORDER BY sequence_no").all();
      return send(response, 200, { orders: orders.map(formatOrder) });
    }

    if (request.method === "POST" && url.pathname === "/orders/mark-synced") {
      const body = await readJson(request);
      if (!Array.isArray(body.synced) || body.synced.length > 100) throw new Error("Provide up to 100 cloud sync results.");
      transact(() => {
        const update = db.prepare("UPDATE offline_orders SET sync_status='SYNCED',synced_at=?,cloud_order_id=? WHERE sequence_no=? AND sync_status='PENDING'");
        for (const result of body.synced) {
          if (!Number.isSafeInteger(result.sequence_no) || typeof result.id !== "string") throw new Error("Each sync result needs a sequence number and cloud order id.");
          update.run(new Date().toISOString(), result.id, result.sequence_no);
        }
      });
      return send(response, 200, { marked_synced: body.synced.length });
    }

    if (request.method === "POST" && url.pathname === "/print") {
      const body = await readJson(request);
      const data = receiptBytes(body);
      const elapsed = await printRaw(data);
      const id = randomBytes(12).toString("hex");
      db.prepare("INSERT INTO print_jobs(id,client_order_id,payload,status,elapsed_ms,created_at) VALUES(?,?,?,?,?,?)")
        .run(id, body.client_order_id || null, JSON.stringify(body), "SENT", Math.round(performance.now() - startedAt), new Date().toISOString());
      return send(response, 200, { id, dispatched_in_ms: Math.round(elapsed), status: "SENT" });
    }

    return send(response, 404, { error: "Unknown local bridge endpoint." });
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : "Local bridge request failed." });
  }
});

server.listen(config.port, config.host, () => console.log(`RMS local bridge listening on http://${config.host}:${config.port}`));

// ── Background Sync Tasks ───────────────────────────────────────────────────────
const backgroundMenuRefresh = setInterval(() => {
  refreshMenuCache().catch((error) => console.error(`Menu cache refresh deferred: ${error.message}`));
}, 5 * 60 * 1000);
backgroundMenuRefresh.unref();
setTimeout(() => refreshMenuCache().catch((error) => console.error(`Initial menu cache refresh deferred: ${error.message}`)), 8000).unref();

const backgroundOrderSync = setInterval(() => syncCounter().catch((error) => console.error(`Counter sync deferred: ${error.message}`)), 8000);
backgroundOrderSync.unref();
setTimeout(() => syncCounter().catch((error) => console.error(`Initial counter sync deferred: ${error.message}`)), 10000).unref();

const backgroundStaffSync = setInterval(() => {
  syncStaffToCloud().catch((error) => console.error(`Staff sync deferred: ${error.message}`));
}, 10000);
backgroundStaffSync.unref();

// Initial staff pull from Supabase (pull down any existing restaurant staff)
setTimeout(() => {
  pullStaffFromCloud().catch((error) => console.error(`Initial staff pull deferred: ${error.message}`));
}, 2000).unref();

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch { /* ignored */ }
}

function startUsbWorker() {
  if (usbWorker && !usbWorker.killed) return;
  usbWorker = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", resolve(root, "raw-usb-printer.ps1")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let ready = false;
  let resolveReady;
  let rejectReady;
  usbReadyPromise = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  usbReadyPromise.catch(() => {});
  usbWorker.stdout.setEncoding("utf8");
  usbWorker.stdout.on("data", (chunk) => {
    usbOutput += chunk;
    let end;
    while ((end = usbOutput.indexOf("\n")) >= 0) {
      const line = usbOutput.slice(0, end).trim(); usbOutput = usbOutput.slice(end + 1);
      if (line === "READY") { ready = true; resolveReady(); continue; }
      const pending = usbRequests.shift();
      if (pending) { clearTimeout(pending.timer); line === "OK" ? pending.resolve() : pending.reject(new Error(line.replace(/^ERR:/, ""))); }
    }
  });
  usbWorker.stderr.on("data", (chunk) => console.error(`USB spooler: ${chunk.toString().trim()}`));
  const failPending = (reason) => { while (usbRequests.length) { const pending = usbRequests.shift(); clearTimeout(pending.timer); pending.reject(reason); } };
  usbWorker.on("error", (error) => { if (!ready) rejectReady(error); failPending(error); });
  usbWorker.on("exit", (code) => { usbWorker = undefined; const error = new Error(`USB spooler exited (${code ?? "unknown"}).`); if (!ready) rejectReady(error); failPending(error); });
}

async function printUsb(data) {
  startUsbWorker();
  await usbReadyPromise;
  return new Promise((resolvePromise, reject) => {
    const request = { resolve: resolvePromise, reject, timer: undefined };
    request.timer = setTimeout(() => {
      const index = usbRequests.indexOf(request);
      if (index >= 0) usbRequests.splice(index, 1);
      reject(new Error("USB printer spooler did not acknowledge the job within 1.5 seconds."));
      usbWorker?.kill();
    }, 1500);
    usbRequests.push(request);
    usbWorker.stdin.write(JSON.stringify({ printer_name: config.printerName, payload: data.toString("base64") }) + "\n", (error) => {
      if (error) { clearTimeout(request.timer); const index = usbRequests.indexOf(request); if (index >= 0) usbRequests.splice(index, 1); reject(error); }
    });
  });
}

function transact(work) {
  db.exec("BEGIN IMMEDIATE");
  try { work(); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function authorized(request) {
  const supplied = request.headers["x-rms-bridge-token"];
  if (typeof supplied !== "string") return false;
  const left = Buffer.from(supplied); const right = Buffer.from(config.token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encryptSession(value) {
  if (!/^[a-f0-9]{64}$/i.test(config.sessionEncryptionKey)) throw new Error("Configure BRIDGE_SESSION_ENCRYPTION_KEY before storing staff sessions.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(config.sessionEncryptionKey, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: encrypted.toString("base64url") });
}

function decryptSession(value) {
  if (!/^[a-f0-9]{64}$/i.test(config.sessionEncryptionKey)) throw new Error("Configure BRIDGE_SESSION_ENCRYPTION_KEY before syncing staff sessions.");
  const stored = JSON.parse(value);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(config.sessionEncryptionKey, "hex"), Buffer.from(stored.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(stored.data, "base64url")), decipher.final()]).toString("utf8"));
}

function send(response, status, body) {
  response.writeHead(status, body === null ? undefined : { "Content-Type": "application/json; charset=utf-8" });
  response.end(body === null ? undefined : JSON.stringify(body));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) { raw += chunk; if (raw.length > 1_000_000) throw new Error("Request body is too large."); }
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("Request body must be valid JSON."); }
}

async function getTenantId() {
  if (!config.supabaseUrl || !config.tenantSlug) return null;
  const key = config.supabaseSecretKey || config.supabaseKey;
  if (!key) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/tenants?select=id&slug=eq.${encodeURIComponent(config.tenantSlug)}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data[0]?.id || null;
  } catch {
    return null;
  }
}

async function fetchMenu() {
  if (!config.supabaseUrl || !config.supabaseKey || !config.tenantSlug) throw new Error("Configure the public Supabase URL/key and RMS_TENANT_SLUG in local-bridge/.env.");
  const tenantId = await getTenantId();
  if (!tenantId) throw new Error("Configured restaurant slug was not found in Supabase.");
  const query = `select=id,name,price,category_id,image_url,in_stock,menu_categories(name)&tenant_id=eq.${tenantId}&order=name`;
  const data = await supabaseGet("menu_items", query);
  return data.map((row) => ({ id: row.id, name: row.name, price: row.price, category_id: row.category_id, category_name: Array.isArray(row.menu_categories) ? row.menu_categories[0]?.name ?? "" : row.menu_categories?.name ?? "", image_url: row.image_url, in_stock: row.in_stock }));
}

async function refreshMenuCache() {
  const rows = await fetchMenu();
  const insert = db.prepare(`INSERT INTO menu_cache(id,name,price,category_id,category_name,image_url,in_stock,updated_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,price=excluded.price,category_id=excluded.category_id,category_name=excluded.category_name,image_url=excluded.image_url,in_stock=excluded.in_stock,updated_at=excluded.updated_at`);
  const refreshedAt = new Date().toISOString();
  transact(() => {
    for (const item of rows) insert.run(item.id, item.name, Number(item.price), item.category_id, item.category_name, item.image_url, item.in_stock ? 1 : 0, refreshedAt);
    const ids = new Set(rows.map((item) => item.id));
    for (const row of db.prepare("SELECT id FROM menu_cache").all()) if (!ids.has(row.id)) db.prepare("DELETE FROM menu_cache WHERE id=?").run(row.id);
  });
  return { cached_items: rows.length, refreshed_at: refreshedAt };
}

async function pullStaffFromCloud() {
  const key = config.supabaseSecretKey || config.supabaseKey;
  if (!config.supabaseUrl || !key || !config.tenantSlug) return;
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return;
    const res = await fetch(`${config.supabaseUrl}/rest/v1/users?select=id,name,role,username,phone,pin_hash,password_hash,active,created_at&tenant_id=eq.${tenantId}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return;
    const cloudUsers = await res.json();
    if (!Array.isArray(cloudUsers)) return;
    transact(() => {
      const now = new Date().toISOString();
      for (const u of cloudUsers) {
        const hash = u.pin_hash || u.password_hash;
        if (!hash) continue;
        const username = u.username || u.phone || u.name.toLowerCase().replace(/\s+/g, "_");
        const role = u.role === "rider" ? "cashier" : u.role;
        const existing = db.prepare("SELECT id FROM staff WHERE id = ? OR LOWER(username) = LOWER(?)").get(u.id, username);
        if (!existing) {
          db.prepare(`INSERT INTO staff(id, username, pin_hash, role, name, active, created_at, updated_at, cloud_synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              u.id, username, hash, role, u.name, u.active ? 1 : 0, u.created_at || now, now, now
            );
        }
      }
    });
  } catch {
    // Cloud offline
  }
}

async function syncStaffToCloud() {
  if (staffSyncRunning) return;
  const key = config.supabaseSecretKey || config.supabaseKey;
  if (!config.supabaseUrl || !key || !config.tenantSlug) return;
  staffSyncRunning = true;
  try {
    const tenantId = await getTenantId();
    if (!tenantId) return;
    const pending = db.prepare("SELECT * FROM staff_sync_queue WHERE status = 'PENDING' ORDER BY created_at LIMIT 20").all();
    for (const item of pending) {
      try {
        const payload = JSON.parse(item.payload);
        if (item.action === "UPSERT") {
          const body = {
            id: payload.id,
            tenant_id: tenantId,
            name: payload.name,
            role: payload.role,
            username: payload.username,
            pin_hash: payload.pin_hash,
            password_hash: ["admin", "manager"].includes(payload.role) ? payload.pin_hash : null,
            active: Boolean(payload.active)
          };
          const res = await fetch(`${config.supabaseUrl}/rest/v1/users`, {
            method: "POST",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates,return=representation"
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000)
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Cloud staff upsert failed (${res.status}): ${errText}`);
          }
        } else if (item.action === "DELETE") {
          const res = await fetch(`${config.supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(item.staff_id)}&tenant_id=eq.${tenantId}`, {
            method: "PATCH",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ active: false }),
            signal: AbortSignal.timeout(8000)
          });
          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Cloud staff deactivate failed (${res.status}): ${errText}`);
          }
        }
        const now = new Date().toISOString();
        db.prepare("UPDATE staff_sync_queue SET status='SYNCED', synced_at=? WHERE id=?").run(now, item.id);
        db.prepare("UPDATE staff SET cloud_synced_at=? WHERE id=?").run(now, item.staff_id);
      } catch (err) {
        db.prepare("UPDATE staff_sync_queue SET error=? WHERE id=?").run(err.message, item.id);
        break;
      }
    }
  } catch {
    // Cloud offline
  } finally {
    staffSyncRunning = false;
  }
}

let genericSyncRunning = false;
function enqueueGenericSync(tableName, recordId, operation, payload) {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO sync_queue(id, table_name, record_id, operation, payload, status, created_at) VALUES(?,?,?,?,?,?,?)")
    .run(id, tableName, recordId, operation, JSON.stringify(payload), "PENDING", now);
  queueMicrotask(() => drainGenericSyncQueue().catch(() => {}));
}

async function drainGenericSyncQueue() {
  if (genericSyncRunning) return;
  genericSyncRunning = true;
  try {
    const key = config.supabaseSecretKey || config.supabaseKey;
    if (!config.supabaseUrl || !key || !config.tenantSlug) return;
    const tenantId = await getTenantId();
    if (!tenantId) return;

    const pending = db.prepare("SELECT * FROM sync_queue WHERE status='PENDING' ORDER BY created_at ASC LIMIT 50").all();
    for (const item of pending) {
      try {
        const payload = JSON.parse(item.payload);
        const endpoint = `${config.supabaseUrl}/rest/v1/${encodeURIComponent(item.table_name)}`;
        let res;
        if (item.operation === "UPSERT") {
          res = await fetch(endpoint, {
            method: "POST",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates"
            },
            body: JSON.stringify({ ...payload, tenant_id: tenantId }),
            signal: AbortSignal.timeout(8000)
          });
        } else if (item.operation === "PATCH") {
          res = await fetch(`${endpoint}?id=eq.${encodeURIComponent(item.record_id)}&tenant_id=eq.${tenantId}`, {
            method: "PATCH",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000)
          });
        } else if (item.operation === "DELETE") {
          res = await fetch(`${endpoint}?id=eq.${encodeURIComponent(item.record_id)}&tenant_id=eq.${tenantId}`, {
            method: "DELETE",
            headers: { apikey: key, Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(8000)
          });
        }
        if (res && !res.ok) {
          const errText = await res.text();
          throw new Error(`Sync failed (${res.status}): ${errText}`);
        }
        const now = new Date().toISOString();
        db.prepare("UPDATE sync_queue SET status='SYNCED', synced_at=? WHERE id=?").run(now, item.id);
      } catch (err) {
        db.prepare("UPDATE sync_queue SET error=? WHERE id=?").run(err.message, item.id);
        break;
      }
    }
  } catch {
    // Cloud offline
  } finally {
    genericSyncRunning = false;
  }
}

async function syncCounter() {
  if (syncRunning) return;
  syncRunning = true;
  try {
    const key = config.supabaseSecretKey || config.supabaseKey;
    const pending = db.prepare("SELECT * FROM offline_orders WHERE sync_status='PENDING' ORDER BY sequence_no LIMIT 100").all().map(formatOrder);
    if (pending.length && config.supabaseUrl && key && config.tenantSlug) {
      const tenantId = await getTenantId();
      if (tenantId) {
        for (const order of pending) {
          try {
            if (order.order_type === "DINE_IN" && order.table_number) {
              await fetch(`${config.supabaseUrl}/rest/v1/restaurant_tables`, {
                method: "POST",
                headers: {
                  apikey: key,
                  Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                  Prefer: "resolution=ignore-duplicates"
                },
                body: JSON.stringify({ tenant_id: tenantId, table_number: order.table_number })
              }).catch(() => {});
            }
            const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/rms_sync_offline_order`, {
              method: "POST",
              headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                p_tenant_id: tenantId,
                p_local_sequence_no: order.sequence_no,
                p_order: {
                  order_type: order.order_type,
                  table_number: order.table_number,
                  customer_name: order.customer_name,
                  customer_phone: order.customer_phone,
                  customer_address: order.customer_address,
                  items: order.items,
                  total_amount: order.total_amount,
                  created_at: order.created_at
                }
              }),
              signal: AbortSignal.timeout(10000)
            });
            if (res.ok) {
              const cloudResult = await res.json();
              db.prepare("UPDATE offline_orders SET sync_status='SYNCED',synced_at=?,cloud_order_id=? WHERE sequence_no=?")
                .run(new Date().toISOString(), cloudResult.id || null, order.sequence_no);
            }
          } catch {
            // Offline - order remains PENDING
          }
        }
      }
    }
    if (config.supabaseUrl && key && config.tenantSlug) {
      const tenantId = await getTenantId();
      if (tenantId) {
        try {
          const remoteRes = await fetch(
            `${config.supabaseUrl}/rest/v1/orders?select=id,order_number,order_type,status,total_amount,customer_name,created_at,order_items(quantity,price_at_order,menu_items(name))&tenant_id=eq.${tenantId}&status=in.(PENDING,PREPARING)&order=created_at.desc&limit=50`,
            {
              headers: { apikey: key, Authorization: `Bearer ${key}` },
              signal: AbortSignal.timeout(6000)
            }
          );
          if (remoteRes.ok) {
            const remoteRows = await remoteRes.json();
            const formattedRemote = remoteRows.map((o) => ({
              id: o.id,
              order_number: o.order_number,
              order_type: o.order_type,
              status: o.status,
              total_amount: o.total_amount,
              created_at: o.created_at,
              customer_name: o.customer_name,
              items: (o.order_items || []).map((oi) => ({
                name: oi.menu_items?.name || "Item",
                quantity: oi.quantity,
                price: oi.price_at_order
              }))
            }));
            const serialized = JSON.stringify(formattedRemote);
            db.prepare("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
              .run("counter_remote_data_cashier", serialized);
            db.prepare("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
              .run("counter_remote_data_kitchen", serialized);
          }
        } catch {
          // Cloud offline
        }
      }
    }
  } finally {
    syncRunning = false;
  }
}

async function supabaseGet(table, query) {
  const key = config.supabaseSecretKey || config.supabaseKey;
  const result = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!result.ok) throw new Error(`Supabase ${table} read failed (${result.status}): ${await result.text()}`);
  return result.json();
}

function normalizeOrder(body) {
  if (!body || typeof body !== "object" || typeof body.client_order_id !== "string" || !/^[\da-f-]{36}$/i.test(body.client_order_id)) throw new Error("A UUID client_order_id is required for duplicate-safe order entry.");
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw new Error("Add between 1 and 50 menu items.");
  const cache = new Map(db.prepare("SELECT id,name,price,in_stock FROM menu_cache").all().map((item) => [item.id, item]));
  const items = body.items.map((requested) => {
    if (!requested || !Number.isInteger(requested.quantity) || requested.quantity < 1 || requested.quantity > 99) throw new Error("Item quantities must be between 1 and 99.");
    const item = cache.get(requested.item_id);
    if (!item || !item.in_stock) throw new Error("An item is missing from the menu cache or is unavailable.");
    return { item_id: item.id, name: item.name, quantity: requested.quantity, price_at_order: Number(item.price) };
  });
  const orderType = body.order_type || "DINE_IN";
  if (!new Set(["DINE_IN", "DELIVERY", "PICKUP"]).has(orderType)) throw new Error("Order type must be DINE_IN, DELIVERY, or PICKUP.");
  const tableNumber = typeof body.table_number === "string" ? body.table_number.trim() : "";
  if (orderType === "DINE_IN" && !tableNumber) throw new Error("Enter a table number for dine-in orders.");
  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
  const customerAddress = typeof body.customer_address === "string" ? body.customer_address.trim() : "";
  if (orderType === "DELIVERY" && !customerAddress) throw new Error("Enter a delivery address.");
  if (orderType === "PICKUP" && !customerPhone) throw new Error("Enter a contact phone number for pickup.");
  const staffId = typeof body.staff_id === "string" ? body.staff_id.trim() : null;
  const staffName = typeof body.staff_name === "string" ? body.staff_name.trim() : null;
  return {
    client_order_id: body.client_order_id,
    table_number: tableNumber || null,
    order_type: orderType,
    customer_name: customerName || null,
    customer_phone: customerPhone || null,
    customer_address: customerAddress || null,
    items,
    total_amount: items.reduce((sum, item) => sum + item.quantity * item.price_at_order, 0),
    staff_id: staffId,
    staff_name: staffName
  };
}

function formatOrder(row) {
  return { ...row, items: JSON.parse(row.items_json), items_json: undefined };
}

function receiptBytes(order) {
  if (!order || typeof order !== "object" || !Array.isArray(order.items)) throw new Error("Print payload must include an items array.");
  const clean = (value) => String(value ?? "").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120);
  const kitchen = order.print_type === "KOT";
  const lines = [
    "\x1b@",
    "\x1ba\x01",
    kitchen ? "KITCHEN TICKET" : "RESTAURANT ORDER",
    "\x1ba\x00",
    "--------------------------------",
    `Order: ${clean(order.order_number || order.sequence_no || order.client_order_id)}`,
    `Type: ${clean(order.order_type)}`,
    ...(order.table_number ? [`Table: ${clean(order.table_number)}`] : []),
    ...(order.staff_name ? [`Staff: ${clean(order.staff_name)}`] : []),
    "--------------------------------",
    ...order.items.map((item) => `${clean(item.name)}  x${Number(item.quantity) || 0}`),
    ...(!kitchen ? ["--------------------------------", `TOTAL: Rs ${Number(order.total_amount || 0).toFixed(2)}`] : []),
    "\n\n\n",
    "\x1dV\x00"
  ];
  return Buffer.from(lines.join("\n"), "ascii");
}

async function printRaw(data) {
  const started = performance.now();
  if (!config.printerHost) {
    if (!config.printerName) {
      // Local offline printer queue fallback
      return performance.now() - started;
    }
    await printUsb(data);
    return performance.now() - started;
  }
  await new Promise((resolvePromise, reject) => {
    const socket = createConnection({ host: config.printerHost, port: config.printerPort, timeout: 1200 }, () => {
      socket.end(data, () => { socket.setTimeout(0); resolvePromise(); });
    });
    socket.on("error", reject); socket.on("timeout", () => socket.destroy(new Error("Printer connection timed out.")));
  });
  return performance.now() - started;
}
