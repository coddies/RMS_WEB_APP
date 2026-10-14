import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSession, sessionCookieName } from "@/lib/staff-auth";
import StaffDashboard from "@/components/StaffDashboard";

export default async function StaffPage() {
  const cookieStore = await cookies();
  const session = readSession(cookieStore.get(sessionCookieName)?.value);
  if (!session) {
    redirect("/login");
  }

  return <StaffDashboard session={session} />;
}
