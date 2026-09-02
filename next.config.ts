import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "playwright"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
