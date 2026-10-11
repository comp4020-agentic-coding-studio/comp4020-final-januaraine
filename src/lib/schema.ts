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

// Room metadata only — never the live game (snakes, food, membership), which
// stays in-memory in src/lib/room-server.ts exactly like the single arena it
// replaces (see docs/decisions/ADR-002-room-based-multiplayer.md). This table
// exists so room names can be enforced unique and listed/searched like any
// other persisted record; db.ts truncates it once at boot, since a restart
// loses every in-memory runtime anyway and a DB row with no matching runtime
// would be an orphan, not a resumable room.
export const rooms = sqliteTable("rooms", {
  id: int().primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  // lower(trim(name)) — a separate column, computed and set by the caller,
  // is how case-insensitive uniqueness is enforced without hand-written
  // collation DDL. `name` itself keeps the creator's original casing.
  nameKey: text("name_key").notNull().unique(),
  creatorPlayerId: int("creator_player_id")
    .notNull()
    .references(() => players.id),
  // "Lock player joining" — solo-play, not a password. See ArenaState in
  // room-server.ts for where this is actually enforced server-side.
  locked: int("locked", { mode: "boolean" }).notNull().default(false),
  // "Allow public viewers" — independent of `locked`: a locked room can
  // still admit Viewers.
  allowViewers: int("allow_viewers", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type Player = typeof players.$inferSelect;
export type Game = typeof games.$inferSelect;
export type Room = typeof rooms.$inferSelect;
