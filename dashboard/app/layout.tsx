import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { FloatingFruits } from "@/components/FloatingFruits";
import { VineScroll } from "@/components/VineScroll";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: "Freshroots Planning Desk",
  description: "Stock recommendations, approvals and purchase orders for Freshroots.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#e9f7ee" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <FloatingFruits />
        <Nav />
        <main className="wrap">{children}</main>
        <VineScroll />
      </body>
    </html>
  );
}
