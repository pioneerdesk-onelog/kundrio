import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Lockfiles außerhalb des Projekts ignorieren
  outputFileTracingRoot: path.join(__dirname),
  // Eigenständiger Server für das Container-Image (Dockerfile)
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Interner Bereich darf nicht eingebettet werden
        source: "/((?!f/|p/|buchen/|api/a/|api/agent/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        // Buchungsseiten sind einbettbar, Verwaltungs- und Einwilligungslinks nicht
        source: "/buchen/(termin|einwilligung)/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
