"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReviewerSelect } from "./ReviewerSelect";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/stock", label: "Stock" },
  { href: "/review", label: "Review" },
  { href: "/orders", label: "Purchase orders" },
];

export function Nav({ reviewer }: { reviewer: string | null }) {
  const path = usePathname();
  return (
    <header className="nav">
      <nav className="nav-inner" aria-label="Main">
        <span className="brand">Freshroots</span>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
        <span className="spacer" />
        <ReviewerSelect current={reviewer} />
      </nav>
    </header>
  );
}
