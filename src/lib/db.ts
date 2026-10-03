import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { desc, eq } from "drizzle-orm";
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

export interface LeaderboardEntry {
  gameId: number;
  displayName: string;
  score: number;
  survivalTimeMs: number;
  finishedAt: string;
}

// Highest score first, ties broken by whoever got there first — the question
// a leaderboard actually answers ("who's best"), not "what happened most
// recently."
export function listLeaderboard(limit = 10): LeaderboardEntry[] {
  const rows = db
    .select({
      gameId: games.id,
      displayName: players.displayName,
      score: games.score,
      survivalTimeMs: games.survivalTimeMs,
      finishedAt: games.finishedAt,
    })
    .from(games)
    .innerJoin(players, eq(games.playerId, players.id))
    .orderBy(desc(games.score), games.finishedAt)
    .limit(limit)
    .all();
  return rows;
}
