import Cashier from "@/components/Cashier";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, sessionCookieName } from "@/lib/staff-auth";
export default async function CashierPage() {
  const session = readSession((await cookies()).get(sessionCookieName)?.value);
  if (!session || !["cashier", "admin"].includes(session.role)) redirect("/login");
  return <Cashier />;
}
