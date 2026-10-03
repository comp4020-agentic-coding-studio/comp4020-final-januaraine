# Snake Arena

A grid-based Snake game you can play in the browser with no sign-up. This is
the **C8 ("it's alive")** milestone: a real, deployed, single-player version —
not a throwaway prototype of one. Every finished game is recorded against an
anonymous, server-issued identity, and the leaderboard it feeds survives a
reload, a restart, and a redeploy.

## Who it's for

Anyone with a browser and a keyboard, for a minute or two at a time — the
"small web" scale the final project brief points at: no account, no
onboarding, no commitment past one game.

## How to play

Open `/play/`. Steer with the arrow keys or `W` `A` `S` `D`. Eating the amber
dot grows the snake and adds to your score; hitting a wall or your own tail
ends the game. Press **Restart** to go again. Your result is saved the moment
the game ends, and shows up on `/leaderboard/`.

## What "good" means for this app, this week

C8's bar is proof of life, read narrowly: a stranger can play the actual
game, not a form or a static mock of one, and find their result still there
when they come back — including after the server itself restarts, since Fly
machines stop when idle. Good for C8 specifically means:

- the snake, the walls and the food behave the way anyone who's played Snake
  before expects, with no surprising edge cases (reversing into your own neck,
  the tail-chase move, eating at the exact edge of the board)
- a submitted score is one the server itself has checked makes sense for how
  long the game ran, not a number it trusted blindly
- the leaderboard is actually a database table, not an in-memory list that a
  Fly machine stopping and restarting would quietly wipe
- the interface tells a new player what to do without them reading this file

What it deliberately does **not** mean yet: multiple players sharing a board,
a visually elaborate arena, or any kind of matchmaking. Those are later
milestones, not missing polish.

I read the final project brief's notes on the small web and on tools built
for a handful of people before writing this — the design choice that follows
most directly from them is scope: one board, one player, one clear loop,
rather than a feature list.

## Design decisions

- **Game rules are a pure, framework-independent core** (`src/game/`): no DOM,
  no Astro, no database. `movement.ts`, `collision.ts`, `food.ts`,
  `rules.ts` and `state.ts` are plain functions over a `GameState` value,
  deterministic given an injected random source. This is what C9 needs —
  moving the authoritative loop from the browser to the server is meant to be
  "call `tick()` somewhere else," not a rewrite of what it computes.
- **The server never trusts a client-reported score outright.** It can't yet
  replay a match tick-by-tick (there's no server-side loop in C8), but it
  doesn't need to: the game's own rules bound what's reachable — at most one
  food per tick — so `score / POINTS_PER_FOOD > ticks` is proof a result was
  fabricated, not a heuristic. See `src/game/validate.ts`.
- **Survival time is counted in ticks, not client wall-clock milliseconds.**
  A tick count is the same deterministic unit the server-side validator and a
  future authoritative loop both reason about; a browser's own clock isn't
  something the server has any reason to trust.
- **The player identity is minted server-side into an httpOnly cookie**
  (`src/lib/session.ts`), never accepted from a request body or query string.
  No endpoint anywhere reads a player id from client input — the only way a
  request is "someone" is by holding that cookie.
- **Astro + SQLite**, the same stack as earlier crits in this course: one
  server-rendered app, one file on the Fly volume, no separate database
  service. It fits the course's 256 MB / one-machine deploy shape, and I
  already know its failure modes from working in it before. If the project
  outgrows SQLite's single-writer model once C9 adds concurrent players, that
  switch gets its own decision record in `PROCESS.md` rather than being
  silently assumed now.

## What is intentionally not implemented yet

- **Realtime multiplayer** (C9): WebSockets, rooms, multiple snakes on one
  board, an authoritative server-side game loop. The architecture is shaped
  for this (see `PROCESS.md`), but none of it runs yet — C8 is single-player,
  client-driven.
- **Observability** (C10): structured logging, metrics, error
  instrumentation. `/api/health` exists as a first, minimal building block,
  not a dashboard.
- No accounts, matchmaking, power-ups, chat, or AI opponents — out of scope
  for the whole final project this early, not just this week.

## Architecture

```
src/
  game/        pure, deterministic rules: types, movement, collision, food,
               rules (tick/setDirection), state, and the result validator —
               no DOM, no framework, importable from a server loop later
  frontend/    the only layer that touches the DOM: keyboard input, canvas
               rendering, and the loop that drives game/* each tick
  lib/         backend: schema (Drizzle), persistence, session identity
  pages/       Astro pages (landing, play, leaderboard, readme) and the
               pages/api/ routes (session, games, leaderboard, health)
```

`src/frontend/loop.ts` is the seam C9 replaces: today it runs `tick()` in a
`setInterval` in the browser and renders locally. A realtime version swaps it
for a WebSocket client that sends input and renders whatever `GameState` the
server broadcasts — `game/*` and `frontend/render.ts` don't change.

## Data model

```
players
  id, session_token (unique, never sent to the client), display_name, created_at

games
  id, player_id, score, ticks, survival_time_ms, started_at, finished_at, status
```

`ticks` is the number the server actually checks a submission against;
`survival_time_ms` is derived from it server-side for display, never taken
from the client. `status` is always `"completed"` for now — the column exists
so a future authoritative game (`"in_progress"`, `"abandoned"`) doesn't need a
schema migration to show up.

## API

| Route | Method | Does |
|---|---|---|
| `/api/session` | GET | Mints (or confirms) the caller's anonymous identity; returns `{ displayName }` |
| `/api/games` | POST | Validates and persists a finished game: `{ score, ticks }` → `{ ok, game }` or `400 { ok: false, reason }` |
| `/api/leaderboard` | GET | Top 10 games by score: `{ entries }` |
| `/api/health` | GET | `{ status: "ok" }` if the database is reachable, `503` otherwise |

## How to run locally

```sh
mise install
pnpm install
pnpm dev        # http://localhost:4321
```

The SQLite file lands in `.data/app.db` (gitignored); delete it to start
fresh.

## How to test

```sh
pnpm check        # typecheck (astro check) + both test suites below
pnpm test:unit    # pure game-logic unit tests (src/game/*.test.ts) — no server needed
pnpm test:spec    # integration tests against a RUNNING app (spec/*.test.ts)
```

`test:spec` needs something answering at `APP_URL` (default
`http://localhost:8080`) — run the built app (`pnpm build && pnpm preview`,
or the Docker image) before calling it directly; `pnpm check` already does
`test:unit` first regardless of whether a server is up.

## How to deploy

```sh
flyctl deploy --remote-only --ha=false -a comp4020-final-januaraine
```

Fly builds `Dockerfile` remotely, runs one `shared-cpu-1x` machine with the
SQLite file on the mounted `/data` volume (`fly.toml`), and serves HTTP on
`$PORT`. Once this repo is public, `.github/workflows/checks.yml` runs the
same deploy on every push to `main`, after `pnpm check` passes against the
built image.
