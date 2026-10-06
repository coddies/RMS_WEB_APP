import Link from "next/link";

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams;
  const backHref = returnTo?.startsWith("/menu?") && !returnTo.startsWith("//") ? returnTo : "/";
  return <main className="privacy-page">
    <p className="eyebrow">Customer information</p>
    <h1>Privacy Policy</h1>
    <p>When you place a delivery or takeaway order, the restaurant collects your name, Pakistani mobile number, delivery address, and the items in your order.</p>
    <p>This information is used to prepare, confirm, and deliver your order and to keep the required order and sales records. It is not used for marketing or sold. Information may be shared only where needed to fulfill your order or meet applicable reporting requirements.</p>
    <p>Your order details are retained with the restaurant’s order history for fulfillment and record keeping.</p>
    <Link href={backHref} className="privacy-link">Back to menu</Link>
  </main>;
}
