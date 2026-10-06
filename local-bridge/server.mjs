import { createServer } from "node:http";
import { createConnection } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(root, ".env"));
loadEnv(resolve(root, "..", ".env.local"));
const config = {
  host: process.env.BRIDGE_HOST || "127.0.0.1",
  port: Number(process.env.BRIDGE_PORT || 8765),
  token: process.env.BRIDGE_TOKEN || "",
  sessionEncryptionKey: process.env.BRIDGE_SESSION_ENCRYPTION_KEY || "",
  database: resolve(root, process.env.BRIDGE_DATABASE || "data/restaurant.sqlite"),
  supabaseUrl: (process.env.RMS_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseKey: process.env.RMS_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
  webAppUrl: (process.env.RMS_WEB_APP_URL || "").replace(/\/$/, ""),
  tenantSlug: process.env.RMS_TENANT_SLUG || "",
  printerHost: process.env.PRINTER_HOST || "",
  printerPort: Number(process.env.PRINTER_PORT || 9100),
  printerName: process.env.PRINTER_NAME || "",
};

if (!config.token || config.token.length < 32) throw new Error("Set BRIDGE_TOKEN in local-bridge/.env to a random value of at least 32 characters.");
mkdirSync(dirname(config.database), { recursive: true });
const db = new DatabaseSync(config.database);
let usbWorker;
let usbOutput = "";
let usbReadyPromise = Promise.resolve();
const usbRequests = [];
let syncRunning = false;
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
    created_at TEXT NOT NULL, synced_at TEXT, cloud_order_id TEXT
  );
  CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY, client_order_id TEXT, payload TEXT NOT NULL,
    status TEXT NOT NULL, elapsed_ms INTEGER, error TEXT, created_at TEXT NOT NULL
  );
`);
for (const [column, definition] of [["counter_status", "TEXT NOT NULL DEFAULT 'PENDING'"], ["payment_status", "TEXT NOT NULL DEFAULT 'PENDING'"]]) {
  if (!db.prepare("PRAGMA table_info(offline_orders)").all().some((row) => row.name === column)) {
    db.exec(`ALTER TABLE offline_orders ADD COLUMN ${column} ${definition}`);
  }
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
      return send(response, 200, { ok: true, sqlite: true, pending_orders: db.prepare("SELECT COUNT(*) AS count FROM offline_orders WHERE sync_status = 'PENDING'").get().count });
    }
    if (!authorized(request)) return send(response, 401, { error: "Local bridge token is missing or invalid." });

    if (request.method === "POST" && url.pathname === "/menu/refresh") return send(response, 200, await refreshMenuCache());
    if (request.method === "GET" && url.pathname === "/menu") {
      return send(response, 200, { items: db.prepare("SELECT id,name,price,category_id,category_name,image_url,in_stock FROM menu_cache ORDER BY category_name,name").all() });
    }
    if (request.method === "GET" && url.pathname === "/counter/state") {
      const items = db.prepare("SELECT id,name,price,category_id,category_name,image_url,in_stock FROM menu_cache ORDER BY category_name,name").all();
      const orders = db.prepare("SELECT * FROM offline_orders ORDER BY sequence_no DESC LIMIT 200").all().map(formatOrder);
      const role = url.searchParams.get("role");
      const remote = new Set(["cashier", "kitchen"]).has(role) ? db.prepare("SELECT value FROM sync_state WHERE key=?").get(`counter_remote_data_${role}`) : null;
      return send(response, 200, { tenant_slug: config.tenantSlug, items, orders, remote_orders: remote ? JSON.parse(remote.value) : [], pending_orders: orders.filter((order) => order.sync_status === "PENDING").length });
    }
    if (request.method === "POST" && url.pathname === "/counter/session") {
      const body = await readJson(request);
      if (!config.webAppUrl || !new Set(["cashier", "kitchen"]).has(body.role) || typeof body.access_token !== "string" || body.access_token.length > 8192 || typeof body.refresh_token !== "string" || body.refresh_token.length > 8192 || !Number.isSafeInteger(body.expires_at)) throw new Error("A valid online Cashier/Kitchen session and production web URL are required.");
      const endpoint = body.role === "cashier" ? "/api/orders" : "/api/staff/kitchen-tickets";
      const probe = await fetch(`${config.webAppUrl}${endpoint}`, { headers: { Authorization: `Bearer ${body.access_token}` }, signal: AbortSignal.timeout(8000) });
      if (!probe.ok) return send(response, 401, { error: "The web server did not accept this staff session." });
      const value = encryptSession({ role: body.role, access_token: body.access_token, refresh_token: body.refresh_token, expires_at: body.expires_at });
      db.prepare("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`counter_session_${body.role}`, value);
      return send(response, 200, { accepted: true, role: body.role });
    }
    if (request.method === "GET" && url.pathname === "/counter/staff-access") {
      const role = url.searchParams.get("role");
      if (!new Set(["cashier", "kitchen"]).has(role)) return send(response, 400, { error: "A Cashier or Kitchen role is required." });
      const saved = db.prepare("SELECT value FROM sync_state WHERE key=?").get(`counter_session_${role}`);
      if (!saved) return send(response, 404, { error: "No Counter staff session is linked." });
      const session = decryptSession(saved.value);
      if (session.role !== role) return send(response, 403, { error: "This staff session does not match the signed-in counter role." });
      if (session.expires_at <= Date.now() + 30000) return send(response, 503, { error: "Staff access token is refreshing; retry shortly." });
      return send(response, 200, { role: session.role, access_token: session.access_token, expires_at: session.expires_at });
    }
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
        db.prepare(`INSERT INTO offline_orders(client_order_id,sequence_no,table_number,order_type,customer_name,customer_phone,customer_address,items_json,total_amount,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(order.client_order_id, sequence, order.table_number, order.order_type, order.customer_name, order.customer_phone, order.customer_address, JSON.stringify(order.items), order.total_amount, new Date().toISOString());
      });
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
const backgroundMenuRefresh = setInterval(() => {
  refreshMenuCache().catch((error) => console.error(`Menu cache refresh deferred: ${error.message}`));
}, 5 * 60 * 1000);
backgroundMenuRefresh.unref();
setTimeout(() => refreshMenuCache().catch((error) => console.error(`Initial menu cache refresh deferred: ${error.message}`)), 8000).unref();
const backgroundOrderSync = setInterval(() => syncCounter().catch((error) => console.error(`Counter sync deferred: ${error.message}`)), 8000);
backgroundOrderSync.unref();
setTimeout(() => syncCounter().catch((error) => console.error(`Initial counter sync deferred: ${error.message}`)), 10000).unref();

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch { /* .env is created from .env.example during setup. */ }
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
async function fetchMenu() {
  if (!config.supabaseUrl || !config.supabaseKey || !config.tenantSlug) throw new Error("Configure the public Supabase URL/key and RMS_TENANT_SLUG in local-bridge/.env.");
  const tenant = await supabaseGet("tenants", `select=id&slug=eq.${encodeURIComponent(config.tenantSlug)}&limit=1`);
  if (!tenant[0]?.id) throw new Error("Configured restaurant slug was not found in Supabase.");
  const query = `select=id,name,price,category_id,image_url,in_stock,menu_categories(name)&tenant_id=eq.${tenant[0].id}&order=name`;
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
async function syncCounter() {
  if (syncRunning || !config.webAppUrl) return;
  const sessions = ["cashier", "kitchen"].map((role) => ({ role, saved: db.prepare("SELECT value FROM sync_state WHERE key=?").get(`counter_session_${role}`) })).filter((entry) => entry.saved);
  if (!sessions.length) return;
  syncRunning = true;
  try {
    for (const { role, saved } of sessions) {
      const session = decryptSession(saved.value);
      if (session.role !== role) continue;
      if (session.expires_at <= Date.now() + 60000) {
        if (!session.refresh_token || !config.supabaseUrl || !config.supabaseKey) throw new Error("The saved staff session cannot be refreshed without Supabase configuration.");
        const refreshResponse = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST", headers: { apikey: config.supabaseKey, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: session.refresh_token }), signal: AbortSignal.timeout(8000),
        });
        if (!refreshResponse.ok) throw new Error(`Staff session refresh failed (${refreshResponse.status}).`);
        const refreshed = await refreshResponse.json();
        session.access_token = refreshed.access_token; session.refresh_token = refreshed.refresh_token;
        session.expires_at = Date.now() + Number(refreshed.expires_in) * 1000;
        db.prepare("UPDATE sync_state SET value=? WHERE key=?").run(encryptSession(session), `counter_session_${role}`);
      }
      const headers = { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
      if (role === "cashier") {
        const pending = db.prepare("SELECT * FROM offline_orders WHERE sync_status='PENDING' ORDER BY sequence_no LIMIT 100").all().map(formatOrder);
        if (pending.length) {
          const result = await fetch(`${config.webAppUrl}/api/offline/sync`, { method: "POST", headers, body: JSON.stringify({ orders: pending }), signal: AbortSignal.timeout(12000) });
          if (!result.ok) throw new Error(`Offline order push failed (${result.status}).`);
          const payload = await result.json();
          transact(() => {
            const update = db.prepare("UPDATE offline_orders SET sync_status='SYNCED',synced_at=?,cloud_order_id=? WHERE sequence_no=? AND sync_status='PENDING'");
            for (const row of payload.synced ?? []) update.run(new Date().toISOString(), row.id, row.sequence_no);
          });
        }
      }
      const path = role === "cashier" ? "/api/orders" : "/api/staff/kitchen-tickets";
      const response = await fetch(`${config.webAppUrl}${path}`, { headers: { Authorization: headers.Authorization }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Online order pull failed (${response.status}).`);
      const payload = await response.json();
      const remote = role === "cashier" ? payload.orders : payload.tickets;
      db.prepare("INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`counter_remote_data_${role}`, JSON.stringify(remote ?? []));
    }
  } finally { syncRunning = false; }
}
async function supabaseGet(table, query) {
  const result = await fetch(`${config.supabaseUrl}/rest/v1/${table}?${query}`, { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } });
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
  if (!new Set(["DINE_IN", "DELIVERY"]).has(orderType)) throw new Error("Order type must be DINE_IN or DELIVERY.");
  const tableNumber = typeof body.table_number === "string" ? body.table_number.trim() : "";
  if (orderType === "DINE_IN" && !tableNumber) throw new Error("Enter a table number for dine-in orders.");
  const customerName = typeof body.customer_name === "string" ? body.customer_name.trim() : "";
  const customerPhone = typeof body.customer_phone === "string" ? body.customer_phone.trim() : "";
  const customerAddress = typeof body.customer_address === "string" ? body.customer_address.trim() : "";
  return { client_order_id: body.client_order_id, table_number: tableNumber || null, order_type: orderType, customer_name: customerName || null, customer_phone: customerPhone || null, customer_address: customerAddress || null, items, total_amount: items.reduce((sum, item) => sum + item.quantity * item.price_at_order, 0) };
}
function formatOrder(row) {
  return { ...row, items: JSON.parse(row.items_json), items_json: undefined };
}
function receiptBytes(order) {
  if (!order || typeof order !== "object" || !Array.isArray(order.items)) throw new Error("Print payload must include an items array.");
  const clean = (value) => String(value ?? "").replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 120);
  const kitchen = order.print_type === "KOT";
  const lines = ["\x1b@", "\x1ba\x01", kitchen ? "KITCHEN TICKET" : "RESTAURANT ORDER", "\x1ba\x00", "--------------------------------", `Order: ${clean(order.order_number || order.client_order_id)}`, `Type: ${clean(order.order_type)}`, ...(order.table_number ? [`Table: ${clean(order.table_number)}`] : []), "--------------------------------", ...order.items.map((item) => `${clean(item.name)}  x${Number(item.quantity) || 0}`), ...(!kitchen ? ["--------------------------------", `TOTAL: Rs ${Number(order.total_amount || 0).toFixed(2)}`] : []), "\n\n\n", "\x1dV\x00"];
  return Buffer.from(lines.join("\n"), "ascii");
}
async function printRaw(data) {
  const started = performance.now();
  if (!config.printerHost) {
    if (!config.printerName) throw new Error("Set PRINTER_HOST for an ESC/POS LAN printer or PRINTER_NAME for an installed Windows USB printer.");
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
