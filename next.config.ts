import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["yahoo-finance2"],
  // lets a second (test) dev server use its own build cache instead of sharing — and corrupting — .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
