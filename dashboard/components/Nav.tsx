"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/review", label: "Review" },
  { href: "/orders", label: "Purchase orders" },
  { href: "/impact", label: "Impact" },
  { href: "/decisions", label: "Review log" },
  { href: "/rules", label: "Rules" },
  { href: "/cost", label: "Cost & health" },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <header className="nav">
      <nav className="nav-inner" aria-label="Main">
        <span className="brand">
          Demand Planning Desk<small>Freshroots</small>
        </span>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
