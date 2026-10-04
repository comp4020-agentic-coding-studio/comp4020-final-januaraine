import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { type SQL, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ticksToMs } from "../game/validate";
import { type Game, type Player, games, players } from "./schema";

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

export type { Game, Player };

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
  const game = db
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

  // Submitting a new result is an explicit opt back into the leaderboard,
  // in case this player previously removed their entry (see
  // hidePlayerFromLeaderboard below).
  db.update(players).set({ hiddenFromLeaderboard: false }).where(eq(players.id, input.playerId)).run();

  return game;
}

// Hides a player's leaderboard entry without touching their games rows —
// the least-destructive reading of "remove my entry" that the current
// schema supports. Cleared automatically the next time they submit a
// result (see recordGameResult).
export function hidePlayerFromLeaderboard(playerId: number): void {
  db.update(players).set({ hiddenFromLeaderboard: true }).where(eq(players.id, playerId)).run();
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

export interface LeaderboardFilters {
  limit?: number;
  player?: string;
  minScore?: number;
  maxScore?: number;
  exactScore?: number;
  /** Inclusive lower bound, compared lexically against the ISO finishedAt. */
  from?: string;
  /** Inclusive upper bound, compared lexically against the ISO finishedAt. */
  to?: string;
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
export function listLeaderboard(filters: LeaderboardFilters = {}): LeaderboardEntry[] {
  const limit = filters.limit ?? 10;

  const conditions: SQL[] = [sql`rn = 1`, sql`hidden = 0`];
  if (filters.player) {
    // Escape LIKE's own wildcards so a literal "%" or "_" in a search term
    // is matched literally, not treated as a pattern.
    const escaped = filters.player.replace(/[\\%_]/g, (char) => `\\${char}`);
    conditions.push(sql`displayName LIKE ${`%${escaped}%`} ESCAPE '\\' COLLATE NOCASE`);
  }
  if (filters.exactScore !== undefined) conditions.push(sql`score = ${filters.exactScore}`);
  if (filters.minScore !== undefined) conditions.push(sql`score >= ${filters.minScore}`);
  if (filters.maxScore !== undefined) conditions.push(sql`score <= ${filters.maxScore}`);
  if (filters.from !== undefined) conditions.push(sql`finishedAt >= ${filters.from}`);
  if (filters.to !== undefined) conditions.push(sql`finishedAt <= ${filters.to}`);

  const rows = db.all<RankedRow>(sql`
    WITH ranked AS (
      SELECT
        g.id AS gameId,
        g.player_id AS playerId,
        p.display_name AS displayName,
        g.score AS score,
        g.survival_time_ms AS survivalTimeMs,
        g.finished_at AS finishedAt,
        p.hidden_from_leaderboard AS hidden,
        ROW_NUMBER() OVER (
          PARTITION BY g.player_id
          ORDER BY g.score DESC, g.finished_at ASC, g.id ASC
        ) AS rn
      FROM games g
      JOIN players p ON p.id = g.player_id
    )
    SELECT gameId, playerId, displayName, score, survivalTimeMs, finishedAt
    FROM ranked
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY score DESC, finishedAt ASC, gameId ASC
    LIMIT ${limit}
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

function parseScoreParam(params: URLSearchParams, name: string, errors: string[]): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${name} must be a non-negative integer`);
    return undefined;
  }
  return value;
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
  const exactScore = parseScoreParam(params, "score", errors);
  const minScore = parseScoreParam(params, "minScore", errors);
  const maxScore = parseScoreParam(params, "maxScore", errors);
  const from = parseDateParam(params, "from", errors);
  const to = parseDateParam(params, "to", errors);

  if (minScore !== undefined && maxScore !== undefined && minScore > maxScore) {
    errors.push("minScore must not be greater than maxScore");
  }
  if (from !== undefined && to !== undefined && from > to) {
    errors.push("from must not be after to");
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, filters: { player, exactScore, minScore, maxScore, from, to } };
}
