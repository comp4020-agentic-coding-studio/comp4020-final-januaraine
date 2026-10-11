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
  markdown: {
    shikiConfig: {
      // Astro's default ("github-dark") bakes a fixed theme's hex colors
      // into every fenced code block's inline style attribute — readme.astro
      // renders that markup once, server-side, so no amount of our own
      // [data-theme="light"] CSS could ever override it. 'css-variables'
      // emits `var(--astro-code-*)` instead (Astro's own markdown pipeline
      // rewrites Shiki's usual `--shiki-*` prefix); styles.css defines those
      // variables per theme the same way it already does for
      // --text/--panel/etc., so README code blocks follow the toggle like
      // everything else on the page, light or dark, no reload required.
      theme: "css-variables",
    },
  },
});
