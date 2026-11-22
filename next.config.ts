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
  // The installer package is only loaded at runtime via createRequire()
  // (src/lib/merge-service.ts) — this entry documents the intent and keeps
  // any accidental import from being bundled.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    // Ship the bundled ffmpeg binary (installer package + the platform
    // binary, e.g. @ffmpeg-installer/linux-x64) inside the /mcp function
    // that runs the merge worker, and the Prisma engine inside every
    // function that touches the DB.
    "/api/**": ["./node_modules/.prisma/client/**"],
    "/mcp": [
      "./node_modules/@ffmpeg-installer/**",
      "./node_modules/.prisma/client/**",
    ],
  },
};

export default nextConfig;
