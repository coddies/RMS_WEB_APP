import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, sessionCookieName } from "@/lib/staff-auth";
import RoleWorkView from "@/components/RoleWorkView";

const views: Record<string, string[]> = {
  admin: ["Menu management", "Inventory", "Staff settings", "Reports", "Offers", "Vendor management"],
  kitchen: ["Kitchen tickets"],
  rider: ["My assigned deliveries"],
};
export default async function StaffPage() {
  const session = readSession((await cookies()).get(sessionCookieName)?.value);
  if (!session || session.role === "cashier") redirect(session ? "/cashier" : "/login");
  return <main className="center-page"><section className="panel"><p className="eyebrow">{session.tenantSlug} · {session.role}</p><h1>Welcome, {session.name}</h1><p className="muted">This account is limited to its permitted work areas.</p>{session.role === "kitchen" || session.role === "rider" ? <RoleWorkView role={session.role} /> : <ul className="role-views">{(views[session.role] ?? []).map((view) => <li key={view}>{view}</li>)}</ul>}<form action="/api/auth/logout" method="post"><button className="button" type="submit">Sign out</button></form>{session.role === "admin" && <p className="muted"><Link href="/admin/menu">Manage menu</Link> · <Link href="/cashier">Open cashier orders</Link></p>}</section></main>;
}
