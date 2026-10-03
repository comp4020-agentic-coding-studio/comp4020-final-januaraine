import { defineConfig } from "vitest/config";

// Pure game-logic tests, colocated under src/game/ — no running app, no
// HTTP, no globalSetup. Separate from vitest.config.ts (the course harness,
// which always tests the RUNNING app over HTTP via spec/global-setup.ts) so
// these can run instantly, anywhere, including with no server up at all.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
