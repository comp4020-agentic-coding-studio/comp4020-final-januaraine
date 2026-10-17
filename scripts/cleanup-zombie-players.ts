#!/usr/bin/env node
// One-off maintenance script, not a route: there is no HTTP endpoint for
// this anywhere in the app, and it should stay that way — deleting someone's
// anonymous identity and every game row they own is not something an
// unauthenticated request should ever be able to trigger (see CLAUDE.md's
// "no second write path" rule for deletePlayerPermanently). Run this by hand,
// from a shell that already has filesystem access to the database file.
//
// Deliberately opens the SQLite file directly with better-sqlite3 rather
// than importing src/lib/db.ts: that module runs a migration and truncates
// the `rooms` table as side effects of being loaded at all (see its own
// comments), and always opens a read-write handle regardless of this
// script's --apply flag. A maintenance script that's supposed to default to
// a safe, read-only preview can't route through a module built around "the
// live app is always allowed to write."
//
// What counts as a "zombie": a player whose *last activity* — see
// lastActivityAt below for exactly what that means — is more than
// `--before-days` (default 90) in the past, AND who is not currently on the
// Top 30 leaderboard (the same ranking listLeaderboard uses for the public
// page, duplicated here as a plain query since db.ts can't be imported for
// the reason above). That second condition is a hard safety net: even a
// very old best score that's still good enough to be shown publicly today
// is never a candidate, no matter how stale its timestamp is.
//
// Deliberately NOT done here:
// - No merging of players. There's no reliable signal in this schema (no
//   device id, no IP, nothing) for "these two anonymous rows are the same
//   human," so guessing would risk splicing two different people's history
//   together under one identity. Only deletion, which loses information but
//   never fabricates it, is on the table.
// - No IP-based identification of any kind, per the project's own scope
//   decision (an anonymous cookie identity is the whole point — see
//   session.ts) and because it would misidentify shared/NAT'd connections.
// - Anyone whose last activity can't be confidently computed is kept, not
//   guessed at — see the "unknown" bucket below.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const dbPath = resolve(process.env.DATABASE_PATH ?? "./.data/app.db");
const apply = process.argv.includes("--apply");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

const beforeDaysRaw = argValue("before-days") ?? "90";
const beforeDays = Number(beforeDaysRaw);
if (!Number.isFinite(beforeDays) || beforeDays <= 0) {
  console.error(`✗ --before-days must be a positive number, got ${JSON.stringify(beforeDaysRaw)}`);
  process.exit(1);
}

// Same limit leaderboard.astro and the /api/leaderboard route pass to
// listLeaderboard — kept as one named constant so "is this player currently
// on the leaderboard" means exactly what a visitor to /leaderboard/ sees.
const LEADERBOARD_PROTECTED_LIMIT = 30;

if (!existsSync(dbPath)) {
  console.error(`✗ no database at ${dbPath} — set DATABASE_PATH if it's somewhere else`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });

interface PlayerActivity {
  playerId: number;
  displayName: string;
  createdAt: string;
  gameCount: number;
  lastGameAt: string | null;
  bestScore: number | null;
  lastActivityAt: string;
}

// "Last activity" for a player with at least one game is the finishedAt of
// their most recent game — not createdAt, which would only tell you when
// the *account* was minted, not when they last actually played. A player
// with zero games has no game activity to measure at all; createdAt is used
// as a lower bound there (how long this empty row has existed), which is
// also exactly the case where there's no score to protect by mistake — see
// the games.* columns in schema.ts.
const candidates = db
  .prepare<{ cutoff: string }, PlayerActivity>(
    `
    WITH activity AS (
      SELECT
        p.id AS playerId,
        p.display_name AS displayName,
        p.created_at AS createdAt,
        COUNT(g.id) AS gameCount,
        MAX(g.finished_at) AS lastGameAt,
        MAX(g.score) AS bestScore
      FROM players p
      LEFT JOIN games g ON g.player_id = p.id
      GROUP BY p.id
    )
    SELECT
      playerId, displayName, createdAt, gameCount, lastGameAt, bestScore,
      CASE WHEN gameCount = 0 THEN createdAt ELSE lastGameAt END AS lastActivityAt
    FROM activity
    WHERE datetime(CASE WHEN gameCount = 0 THEN createdAt ELSE lastGameAt END) < datetime('now', @cutoff)
    ORDER BY playerId
    `,
  )
  .all({ cutoff: `-${beforeDays} days` });

// Mirrors listLeaderboard's own ranking (db.ts): one row per player, their
// best game by score (ties broken by earliest finish, then game id), top N
// by that score. Protects exactly the set of players currently shown on
// /leaderboard/, regardless of how old their winning run was.
const topPlayerIds = new Set(
  db
    .prepare<{ limit: number }, { playerId: number }>(
      `
      WITH ranked AS (
        SELECT
          g.player_id AS playerId,
          g.score AS score,
          ROW_NUMBER() OVER (
            PARTITION BY g.player_id
            ORDER BY g.score DESC, g.finished_at ASC, g.id ASC
          ) AS rn
        FROM games g
      )
      SELECT playerId
      FROM ranked
      WHERE rn = 1
      ORDER BY score DESC
      LIMIT @limit
      `,
    )
    .all({ limit: LEADERBOARD_PROTECTED_LIMIT })
    .map((row) => row.playerId),
);

const zombies = candidates.filter((row) => !topPlayerIds.has(row.playerId));
const skippedAsProtected = candidates.filter((row) => topPlayerIds.has(row.playerId));

console.log(`Database: ${dbPath}`);
console.log(`Cutoff: last activity before ${beforeDays} day(s) ago`);
console.log(`Mode: ${apply ? "APPLY (will delete)" : "dry-run (preview only)"}`);
console.log("");

if (skippedAsProtected.length > 0) {
  console.log(`Protected (stale but still in the Top ${LEADERBOARD_PROTECTED_LIMIT} leaderboard, kept):`);
  for (const row of skippedAsProtected) {
    console.log(
      `  player ${row.playerId} "${row.displayName}" — best score ${row.bestScore}, last activity ${row.lastActivityAt}`,
    );
  }
  console.log("");
}

if (zombies.length === 0) {
  console.log("No zombie players found. Nothing to do.");
  process.exit(0);
}

console.log(`Zombie candidates (${zombies.length}):`);
for (const row of zombies) {
  const activityNote =
    row.gameCount === 0
      ? `0 games — createdAt used as last-activity lower bound (${row.createdAt})`
      : `${row.gameCount} game(s), last finished ${row.lastGameAt}, best score ${row.bestScore}`;
  console.log(`  player ${row.playerId} "${row.displayName}" — ${activityNote}`);
}
console.log("");
console.log(`Player IDs: ${zombies.map((row) => row.playerId).join(", ")}`);

if (!apply) {
  console.log("");
  console.log("Dry run only — no rows were changed. Re-run with --apply to delete these players.");
  process.exit(0);
}

const backupDir = dirname(dbPath);
mkdirSync(backupDir, { recursive: true });
const backupPath = resolve(backupDir, `${randomUUID()}-pre-cleanup-backup.db`);
// A fresh readonly connection for the backup, not the read-write handle
// above: better-sqlite3's online backup API copies through a SQLite-level
// backup cursor (safe under WAL, unlike `cp` on a live db file).
const backupSource = new Database(dbPath, { readonly: true, fileMustExist: true });
await backupSource.backup(backupPath);
backupSource.close();
console.log(`Backup written to ${backupPath}`);

// Same games-then-player shape as deletePlayerPermanently in src/lib/db.ts,
// plus one thing that function doesn't handle: rooms.creator_player_id has a
// foreign key to players.id, and `rooms` is only truncated at server boot
// (see db.ts's own comment on that), not continuously — so a zombie who
// once created a room still has a live `rooms` row between restarts, and
// deleting the player first would hit a foreign-key-constraint error. Room
// *metadata* is explicitly disposable in this schema's own design (a room
// row with no matching in-memory runtime is already treated as orphaned),
// so removing it here is consistent with that, not a new kind of deletion.
// All three deletes run in one transaction so a mid-failure can't leave any
// of them orphaned.
const deletePlayerTx = db.transaction((playerId: number) => {
  db.prepare("DELETE FROM rooms WHERE creator_player_id = ?").run(playerId);
  db.prepare("DELETE FROM games WHERE player_id = ?").run(playerId);
  db.prepare("DELETE FROM players WHERE id = ?").run(playerId);
});

for (const row of zombies) {
  deletePlayerTx(row.playerId);
}

console.log("");
console.log(`Deleted ${zombies.length} player(s): ${zombies.map((row) => row.playerId).join(", ")}`);
