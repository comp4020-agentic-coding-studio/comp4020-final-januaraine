import { defineConfig } from "vitest/config";

// Pure logic tests — game logic colocated under src/game/, plus standalone
// dev-tooling tests under scripts/ (e.g. the spec-safety guard) — no
// running app, no HTTP, no globalSetup. Separate from vitest.config.ts (the
// course harness, which always tests the RUNNING app over HTTP via
// spec/global-setup.ts) so these can run instantly, anywhere, including
// with no server up at all.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
