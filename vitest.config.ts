import { defineConfig } from "vitest/config";

// Every test in spec/ runs against the running app, which spec/global-setup.ts
// finds. Only spec/ runs: a test anywhere else needs adding to `include`.
//
// fileParallelism is off because every spec file shares one mutable
// server/database: with it on, one file's writes (a submitted game, a
// deleted leaderboard entry) can land between two requests another file
// makes and relies on being stable, e.g. "fetching the leaderboard twice in
// a row returns the same thing."
export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
    fileParallelism: false,
  },
});
