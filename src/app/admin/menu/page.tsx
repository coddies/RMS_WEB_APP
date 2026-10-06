import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, sessionCookieName } from "@/lib/staff-auth";
import MenuManagement from "@/components/MenuManagement";

export default async function MenuManagementPage() {
  const session = readSession((await cookies()).get(sessionCookieName)?.value);
  if (!session || session.role !== "admin") redirect("/login");
  return <MenuManagement />;
}
