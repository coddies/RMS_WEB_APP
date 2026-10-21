"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: "home" | "search" | "cart" | "orders" | "profile";
};

const items: NavItem[] = [
  { label: "Home", href: "/", icon: "home" },
  { label: "Search", href: "/#menu-search", icon: "search" },
  { label: "Cart", href: "/#customer-cart", icon: "cart" },
  { label: "Orders", href: "/#customer-orders", icon: "orders" },
  { label: "Profile", href: "/#customer-profile", icon: "profile" },
];

function Icon({ name }: { name: NavItem["icon"] }) {
  const paths: Record<NavItem["icon"], ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    cart: <><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 9H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></>,
    orders: <><path d="M6 3h12v18H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0" /></>,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function CustomerNavigation({ active }: { active: boolean }) {
  return (
    <>
      <nav className="customer-top-nav" aria-label="Main navigation">
        <Link className="customer-wordmark" href="/">Menu</Link>
        <div className="customer-top-links">
          {items.map((item, index) => (
            <Link key={item.label} href={item.href} aria-current={index === 0 && active ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      <nav className="customer-bottom-nav" aria-label="Main navigation">
        {items.map((item, index) => (
          <Link
            key={item.label}
            className={`customer-nav-item${index === 0 && active ? " is-active" : ""}${item.icon === "cart" ? " customer-cart-nav" : ""}`}
            href={item.href}
            aria-current={index === 0 && active ? "page" : undefined}
          >
            <span className="customer-nav-icon"><Icon name={item.icon} /></span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

function isCustomerPage(pathname: string) {
  return pathname === "/" || pathname === "/menu" || pathname === "/privacy";
}

export default function CustomerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!isCustomerPage(pathname)) return children;

  return (
    <div className="customer-shell">
      <CustomerNavigation active={pathname === "/" || pathname === "/menu"} />
      <div className="customer-content">{children}</div>
    </div>
  );
}
