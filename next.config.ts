import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output is only needed for the local sandbox runner
  // (`bun .next/standalone/server.js`); Vercel builds its own output.
  output: process.env.VERCEL ? undefined : "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Keep the static ffmpeg binary out of the JS bundle and require it at
  // runtime (serverless-friendly; falls back to PATH `ffmpeg` locally).
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    // Ship the bundled ffmpeg binary + Prisma engine files inside every
    // serverless function that touches the DB or the merge worker.
    "/api/**": [
      "./node_modules/@ffmpeg-installer/ffmpeg/**",
      "./node_modules/.prisma/client/**",
    ],
    "/mcp": [
      "./node_modules/@ffmpeg-installer/ffmpeg/**",
      "./node_modules/.prisma/client/**",
    ],
  },
};

export default nextConfig;
