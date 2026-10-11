import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { type SQL, desc, eq, like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ticksToMs } from "../game/validate";
import { type Game, type Player, type Room, games, players, rooms } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload, a restart and a redeploy; locally it defaults
// to an untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`, commit
// the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

// Room *metadata* survives in SQLite (so names stay unique and listable),
// but a room's live state — its arena, membership, connections — lives only
// in src/lib/room-server.ts's in-memory registry, same as the arena it
// replaces, and a restart loses all of it. A `rooms` row with no matching
// runtime would be a room nobody can ever actually join again, so rather
// than let that accumulate, every boot starts with an empty table: this is
// a deliberate consequence of the single-instance, memory-only-live-state
// assumption (see docs/decisions/ADR-002-room-based-multiplayer.md), not a
// data-loss bug. `games`/`players` are untouched — those are real history.
db.delete(rooms).run();

export type { Game, Player, Room };

export function findPlayerByToken(sessionToken: string): Player | null {
  return db.select().from(players).where(eq(players.sessionToken, sessionToken)).get() ?? null;
}

export function createPlayer(input: { sessionToken: string; displayName: string }): Player {
  return db.insert(players).values(input).returning().get();
}

// Persistence only — whether a result is plausible is game/validate.ts's
// job, checked by the API route before this is ever called. This function
// trusts its caller to have already validated `score`/`ticks`; it never
// re-derives survivalTimeMs from anything the client sent directly.
export function recordGameResult(input: { playerId: number; score: number; ticks: number }): Game {
  const survivalTimeMs = ticksToMs(input.ticks);
  const finishedAt = new Date();
  const startedAt = new Date(finishedAt.getTime() - survivalTimeMs);
  return db
    .insert(games)
    .values({
      playerId: input.playerId,
      score: input.score,
      ticks: input.ticks,
      survivalTimeMs,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status: "completed",
    })
    .returning()
    .get();
}

// Permanently erases a player's anonymous identity: every game row they
// own, then the players row itself. "Remove my record" means this, not a
// visibility flag — nothing here can be undone, and nothing is left behind
// for a reused session token to reattach to (see session.ts's
// getOrCreatePlayer: a token with no matching players row always mints a
// fresh identity, which is what makes this deletion actually final rather
// than just hidden).
//
// Wrapped in a transaction so a mid-delete failure can't leave games rows
// pointing at a player that's already gone — better-sqlite3's driver runs
// this as BEGIN/COMMIT, rolling back on any thrown error.
export function deletePlayerPermanently(playerId: number): void {
  db.transaction((tx) => {
    tx.delete(games).where(eq(games.playerId, playerId)).run();
    tx.delete(players).where(eq(players.id, playerId)).run();
  });
}

// Canonical form of a room name used only for the uniqueness check — trimmed
// and lowercased, so "Snake Pit", " snake pit ", and "SNAKE PIT" all collide.
// The display name (`name`) keeps whatever casing the creator typed.
export function roomNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface CreateRoomInput {
  name: string;
  creatorPlayerId: number;
  locked: boolean;
  allowViewers: boolean;
}

export interface RoomNameTaken {
  ok: false;
  reason: "name taken";
}

// The uniqueness check that actually matters: the `rooms_name_key_unique`
// index, not a prior SELECT (which would leave a window for two concurrent
// creates of the same name to both pass). A second insert for the same
// nameKey throws; this catches exactly that failure and reports it as a
// normal "taken" result rather than a 500.
export function createRoom(input: CreateRoomInput): { ok: true; room: Room } | RoomNameTaken {
  try {
    const room = db
      .insert(rooms)
      .values({
        name: input.name,
        nameKey: roomNameKey(input.name),
        creatorPlayerId: input.creatorPlayerId,
        locked: input.locked,
        allowViewers: input.allowViewers,
      })
      .returning()
      .get();
    return { ok: true, room };
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed.*rooms/i.test(error.message)) {
      return { ok: false, reason: "name taken" };
    }
    throw error;
  }
}

export function findRoomById(id: number): Room | null {
  return db.select().from(rooms).where(eq(rooms.id, id)).get() ?? null;
}

export function deleteRoom(id: number): void {
  db.delete(rooms).where(eq(rooms.id, id)).run();
}

export interface RoomListFilters {
  search?: string;
  limit?: number;
  offset?: number;
}

// Listing is cheap (just these columns, no join, no live state) — the
// "appropriate listing strategy" for a potentially large room count is this
// plain paginated query; it's lobby *previews* that are expensive and stay
// bounded separately (see room-server.ts). SQLite's LIKE is already
// case-insensitive for ASCII by default, which is what "handle case
// consistently" means here — no COLLATE needed.
export function listRooms(filters: RoomListFilters = {}): Room[] {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;
  const query = db.select().from(rooms);
  const rows = filters.search ? query.where(like(rooms.name, `%${filters.search}%`)) : query;
  return rows
    .orderBy(desc(rooms.createdAt), desc(rooms.id))
    .limit(limit)
    .offset(offset)
    .all();
}

export interface LeaderboardEntry {
  gameId: number;
  displayName: string;
  score: number;
  survivalTimeMs: number;
  finishedAt: string;
  // True only on the row belonging to the caller's own session — lets the
  // UI show a delete control on exactly one row without ever handing the
  // client anyone's internal player id.
  isMine: boolean;
}

export type LeaderboardSort = "asc" | "desc";

export interface LeaderboardFilters {
  limit?: number;
  player?: string;
  /** Inclusive lower bound, compared lexically against the ISO finishedAt. */
  from?: string;
  /** Inclusive upper bound, compared lexically against the ISO finishedAt. */
  to?: string;
  /** Order of the final, already-deduped player list. Default "desc". */
  sort?: LeaderboardSort;
  currentPlayerId?: number | null;
}

interface RankedRow {
  gameId: number;
  playerId: number;
  displayName: string;
  score: number;
  survivalTimeMs: number;
  finishedAt: string;
}

// One row per player — their personal-best run — not one row per game.
// Dedupe happens here, at the query level, via a window function: a plain
// GROUP BY MAX(score) can't also report which run (survivalTimeMs,
// finishedAt) produced that score, so this ranks every player's own runs
// (highest score first, earliest finish breaking a tie, game id breaking
// anything left) and keeps only rank 1 per player. Drizzle's query builder
// has no window-function support, hence the raw SQL rather than
// .select()/.orderBy().
//
// That inner ranking is always highest-score-first, regardless of the
// requested display sort: "personal best" means the same thing either way,
// and `sort` only reorders the resulting one-row-per-player set, never
// which run represents a player. The player/date filters narrow which runs
// are even candidates for that per-player ranking, so filtering, dedupe and
// sort stay in the one query instead of a partial frontend re-derivation.
//
// `sort` must only change the *display order* of the Top N, not which N
// players those are: membership is always decided by score DESC, LIMIT
// first (the inner `top` CTE below), and only then does the outer SELECT
// re-order that already-fixed set for `sort=asc`. Applying sortDirection
// before LIMIT instead would make "Lowest score first" fetch the lowest
// scores out of every candidate (a different, bottom-of-the-barrel set),
// not the same Top N players shown in reverse.
export function listLeaderboard(filters: LeaderboardFilters = {}): LeaderboardEntry[] {
  const limit = filters.limit ?? 10;
  const sortDirection = filters.sort === "asc" ? sql`ASC` : sql`DESC`;

  // Date filters narrow the candidate runs *before* ranking, not after:
  // a player's displayed result must be their best run within the selected
  // range, not their all-time best filtered out because it happened to
  // fall outside it. Only rn=1 and the player-name filter apply after
  // ranking, since neither changes which run counts as "this player's
  // best" — they just decide whether that one resulting row is shown.
  const candidateConditions: SQL[] = [];
  if (filters.from !== undefined) candidateConditions.push(sql`g.finished_at >= ${filters.from}`);
  if (filters.to !== undefined) candidateConditions.push(sql`g.finished_at <= ${filters.to}`);
  const candidateWhere = candidateConditions.length > 0 ? sql.join(candidateConditions, sql` AND `) : sql`1 = 1`;

  const conditions: SQL[] = [sql`rn = 1`];
  if (filters.player) {
    // Escape LIKE's own wildcards so a literal "%" or "_" in a search term
    // is matched literally, not treated as a pattern.
    const escaped = filters.player.replace(/[\\%_]/g, (char) => `\\${char}`);
    conditions.push(sql`displayName LIKE ${`%${escaped}%`} ESCAPE '\\' COLLATE NOCASE`);
  }

  const rows = db.all<RankedRow>(sql`
    WITH candidates AS (
      SELECT g.id, g.player_id, g.score, g.survival_time_ms, g.finished_at
      FROM games g
      WHERE ${candidateWhere}
    ),
    ranked AS (
      SELECT
        c.id AS gameId,
        c.player_id AS playerId,
        p.display_name AS displayName,
        c.score AS score,
        c.survival_time_ms AS survivalTimeMs,
        c.finished_at AS finishedAt,
        ROW_NUMBER() OVER (
          PARTITION BY c.player_id
          ORDER BY c.score DESC, c.finished_at ASC, c.id ASC
        ) AS rn
      FROM candidates c
      JOIN players p ON p.id = c.player_id
    ),
    top AS (
      SELECT gameId, playerId, displayName, score, survivalTimeMs, finishedAt
      FROM ranked
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY score DESC, finishedAt ASC, gameId ASC
      LIMIT ${limit}
    )
    SELECT gameId, playerId, displayName, score, survivalTimeMs, finishedAt
    FROM top
    ORDER BY score ${sortDirection}, finishedAt ASC, gameId ASC
  `);

  return rows.map((row) => ({
    gameId: row.gameId,
    displayName: row.displayName,
    score: row.score,
    survivalTimeMs: row.survivalTimeMs,
    finishedAt: row.finishedAt,
    isMine: filters.currentPlayerId != null && row.playerId === filters.currentPlayerId,
  }));
}

export interface ParsedLeaderboardQuery {
  ok: true;
  filters: Omit<LeaderboardFilters, "limit" | "currentPlayerId">;
}
export interface InvalidLeaderboardQuery {
  ok: false;
  errors: string[];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseSortParam(params: URLSearchParams, errors: string[]): LeaderboardSort {
  const raw = params.get("sort");
  if (raw === null || raw === "") return "desc";
  if (raw === "asc" || raw === "desc") return raw;
  errors.push('sort must be "asc" or "desc"');
  return "desc";
}

// `from`/`to` are compared lexically against finishedAt, which is always
// stored as a UTC ISO string (new Date().toISOString()) — so a bare date
// like "2026-10-04" is expanded to UTC day bounds here, keeping the
// comparison meaningful regardless of the server's local timezone.
function parseDateParam(
  params: URLSearchParams,
  name: "from" | "to",
  errors: string[],
): string | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  const expanded = DATE_ONLY.test(raw) ? `${raw}T${name === "from" ? "00:00:00.000" : "23:59:59.999"}Z` : raw;
  if (Number.isNaN(Date.parse(expanded))) {
    errors.push(`${name} must be a valid date`);
    return undefined;
  }
  return expanded;
}

// Shared by the leaderboard API route and the server-rendered leaderboard
// page, so query-string validation lives in exactly one place.
export function parseLeaderboardQuery(params: URLSearchParams): ParsedLeaderboardQuery | InvalidLeaderboardQuery {
  const errors: string[] = [];

  const player = params.get("player")?.trim().slice(0, 100) || undefined;
  const from = parseDateParam(params, "from", errors);
  const to = parseDateParam(params, "to", errors);
  const sort = parseSortParam(params, errors);

  if (from !== undefined && to !== undefined && from > to) {
    errors.push("from must not be after to");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, filters: { player, from, to, sort } };
}
