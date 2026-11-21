import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:8787";
const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // partialPrefetching: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
