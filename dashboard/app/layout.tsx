import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { VineScroll } from "@/components/VineScroll";
import { currentReviewer } from "@/lib/reviewer";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: "Freshroots Demand Planning",
  description: "Stock, recommendations, approvals and purchase orders for Freshroots.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const reviewer = await currentReviewer();
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <Nav reviewer={reviewer} />
        <main className="wrap">{children}</main>
        <VineScroll />
      </body>
    </html>
  );
}
