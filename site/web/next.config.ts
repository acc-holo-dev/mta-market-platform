/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace TS package consumed by the app (PLAN-010: site/shared).
  transpilePackages: ["@mta-market/shared"],
  // Standalone tracing is enabled in the Linux production image. Keeping it
  // disabled locally avoids pnpm symlink limitations on Windows.
  output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
  async rewrites() {
    // Same-origin API access (mirrors the production nginx topology of
    // /api/ -> backend). When NEXT_PUBLIC_API_URL is "/api", the browser
    // talks to the web origin only — no CORS, no cross-site cookies — so
    // the site works from any host/IP that can reach this server.
    if (process.env.NEXT_PUBLIC_API_URL === "/api") {
      return [
        {
          source: "/api/:path*",
          destination: `${process.env.API_PROXY_TARGET || "http://127.0.0.1:3001"}/:path*`,
        },
        {
          // Public media (covers/screenshots/banners) is served by the
          // backend at /media/:name — same-origin dev mirror of nginx.
          source: "/media/:path*",
          destination: `${process.env.API_PROXY_TARGET || "http://127.0.0.1:3001"}/media/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
