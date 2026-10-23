import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CSV uploads go through a server action; Vercel itself caps a request body at about 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // The in-memory test database (used only by the automated tests) ships WebAssembly files, so keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
