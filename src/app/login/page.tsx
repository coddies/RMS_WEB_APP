"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState("cashier");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenant: form.get("tenant"), role, identity: form.get("identity"), credential }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not sign in.");
      router.replace(result.destination);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
  const admin = role === "admin";
  function appendDigit(value: string) { setCredential((current) => (current + value).slice(0, 12)); }
  return <main className="center-page"><form className="panel login-panel" onSubmit={submit}><p className="eyebrow">Restaurant staff</p><h1>Sign in</h1><p className="muted">Use your restaurant account. Customer ordering stays guest-only.</p><label>Restaurant slug<input name="tenant" autoComplete="organization" required /></label><label>Your role<select value={role} onChange={(event) => { setRole(event.target.value); setCredential(""); }}><option value="cashier">Cashier</option><option value="kitchen">Kitchen / Chef</option><option value="admin">Manager / Admin</option><option value="rider">Rider</option></select></label><label>{role === "rider" ? "Phone number" : "Username"}<input name="identity" autoComplete="username" required /></label><label>{admin ? "Password" : "PIN"}<input name="credential" type="password" value={credential} inputMode={admin ? "text" : "numeric"} autoComplete={admin ? "current-password" : "off"} minLength={admin ? undefined : 4} maxLength={128} onChange={(event) => setCredential(event.target.value)} required /></label>{!admin && <div className="pin-pad" aria-label="PIN keypad">{["1","2","3","4","5","6","7","8","9","clear","0","back"].map((key) => <button key={key} type="button" className={key === "clear" || key === "back" ? "pin-pad-action" : ""} onClick={() => key === "clear" ? setCredential("") : key === "back" ? setCredential((current) => current.slice(0, -1)) : appendDigit(key)}>{key === "clear" ? "Clear" : key === "back" ? "⌫" : key}</button>)}</div>}{error && <p className="inline-error" role="alert">{error}</p>}<button className="button login-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></main>;
}
