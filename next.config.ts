import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The SetFlow station prototype is a static app in /public; serve it at the root.
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/index.html" }],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
