import type { Metadata } from "next";
import CustomerShell from "@/components/CustomerShell";
import "./styles.css";
export const metadata: Metadata = { title: "Table Order", description: "Restaurant dine-in ordering" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <CustomerShell>{children}</CustomerShell>
      </body>
    </html>
  );
}
