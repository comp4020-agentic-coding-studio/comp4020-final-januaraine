import { sql } from "drizzle-orm";
import { int, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The database is the ground truth. To change it: edit here, run
// `pnpm db:generate` to turn the diff into a migration under drizzle/, and
// commit both — the migration applies automatically when the server boots
// (see db.ts). Never edit the database by hand: state on the deployed volume
// outlives every deploy, and the migration trail is what keeps old state and
// new code compatible.
export const players = sqliteTable("players", {
  id: int().primaryKey({ autoIncrement: true }),
  // A random id set in a cookie the first time a browser plays — not an
  // account, just "did this browser mint this player row." The server
  // generates both this and displayName; a client never supplies either (see
  // session.ts).
  sessionToken: text("session_token").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const games = sqliteTable("games", {
  id: int().primaryKey({ autoIncrement: true }),
  playerId: int("player_id")
    .notNull()
    .references(() => players.id),
  score: int().notNull(),
  // The authoritative survival-time unit (see game/config.ts) — an integer
  // tick count, not a client-reported wall-clock duration. survivalTimeMs is
  // derived from it server-side, never taken from the client directly.
  ticks: int().notNull(),
  survivalTimeMs: int("survival_time_ms").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  // Always "completed" for C8 (the only kind of row a single-player game
  // produces). C9's authoritative server loop is what will ever write
  // "in_progress" or "abandoned" — the column exists now so that doesn't
  // need a schema migration later.
  status: text().notNull().default("completed"),
});

export type Player = typeof players.$inferSelect;
export type Game = typeof games.$inferSelect;
