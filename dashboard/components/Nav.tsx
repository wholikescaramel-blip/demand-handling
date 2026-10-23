"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/review", label: "Review" },
  { href: "/orders", label: "Purchase orders" },
  { href: "/data", label: "Data" },
  { href: "/rules", label: "Rules" },
  { href: "/impact", label: "Impact" },
  { href: "/decisions", label: "Review log" },
];

export function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <header className="nav">
      <nav className="nav-inner" aria-label="Main">
        <span className="brand">
          <span className="logo" aria-hidden="true">🌱</span>
          Freshroots<small>Planning Desk</small>
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
