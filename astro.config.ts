import node from "@astrojs/node";
import { defineConfig } from "astro/config";

// Server-rendered output: the leaderboard and player identity read the
// database per request, and `astro build` emits the Node server the
// Dockerfile runs.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  security: {
    // Fly's proxy terminates TLS, so naming the deploy domain is what lets
    // Astro trust x-forwarded-proto and accept same-origin form/API POSTs.
    allowedDomains: [{ hostname: "**.fly.dev", protocol: "https" }],
  },
});
