# Snake Arena

A grid-based Snake game you can play in the browser with no sign-up, in a
shared arena with whoever else is in the room right now. C8 was a
single-player core; **C9 ("all at once")** replaced it with the current
multiplayer game, where the server runs an authoritative arena that every
connected player's moves, collisions, and eliminations affect in real time.
The single-player entry has since been retired — `/play/` now redirects to
the Arena lobby. Every finished run is recorded against an anonymous,
server-issued identity, and the leaderboard it feeds survives a reload, a
restart, and a redeploy.

## Who it's for

Anyone with a browser and a keyboard, for a minute or two at a time — the
"small web" scale the final project brief points at: no account, no
onboarding, no commitment past one game.

## How to play

Open `/arena/` to join or create a room, then steer with the arrow keys or
`W` `A` `S` `D`. Eating the amber dot grows your snake and adds to your
score; hitting a wall, your own tail, or another player's snake ends your
run. Other players' snakes move and react in real time with no reload, and a
**Respawn** button appears the moment you're eliminated. Your result is
saved the instant a run ends and shows up on `/leaderboard/`.

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

What it deliberately did **not** mean yet: multiple players sharing a board,
a visually elaborate arena, or any kind of matchmaking. Those were later
milestones, not missing polish — and the first two landed this week.

I read the final project brief's notes on the small web and on tools built
for a handful of people before writing this — the design choice that follows
most directly from them is scope: one board, one player, one clear loop,
rather than a feature list. The same read is why C9 added one shared board
for everyone currently playing, not a matchmaking system.

## What "good" means for C9

C9's bar is that the presence of other people isn't cosmetic: a second
browser session, opened right now, sees a player move, eat, grow, collide,
and get eliminated in close to real time — with nobody reloading anything —
and that outcome is the server's decision, never something either browser
is trusted to assert about itself. Concretely:

- opening `/arena/` in two genuinely separate browser sessions (not two
  tabs sharing one cookie — that's one identity, not two players) puts both
  in the same board, and a direction change in one is visible in the other
  within about a second
- the server computes every snake's movement, every collision, and every
  score; a client only ever sends "I want to turn this way"
  (`POST /api/arena/input`), never a position or a score
- a dropped connection and a deliberate elimination are different things
  and behave differently on purpose — see
  [`docs/decisions/ADR-001-realtime-multiplayer.md`](docs/decisions/ADR-001-realtime-multiplayer.md)
  for the reasoning, the alternatives considered, and what this choice costs
- none of this changed C8's bar at the time: single-player stayed untouched
  and client-driven exactly as it was, running alongside the arena. (A later
  cleanup has since retired that single-player entry — see "How to play".)

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
  already know its failure modes from working in it before. C9's concurrent
  players turned out not to need a different database at all — see below.
- **Server-Sent Events, not WebSockets, for the realtime channel.** The
  Astro node adapter's standalone mode doesn't expose a raw HTTP server for
  a WebSocket upgrade without ejecting it (a custom entry script, a
  Dockerfile change, separate dev-mode wiring); a streaming `Response` needs
  none of that and works identically in dev and in the built server. A
  current Fly.io community report of WebSocket-upgrade requests failing at
  the edge for reasons unrelated to the app was the deciding factor against
  the alternative — a real operational risk, not just a preference.
- **One shared arena, held entirely in memory, not per-tick writes to
  SQLite.** A player's run is only ever persisted through the exact same
  `recordGameResult` path single-player already used, once, when they're
  eliminated — the server just computes the `{ score, ticks }` it passes
  in, instead of trusting a client to report them. See
  [`docs/decisions/ADR-001-realtime-multiplayer.md`](docs/decisions/ADR-001-realtime-multiplayer.md)
  for why a shared arena, not rooms or matches, and how simultaneous input,
  disconnects, and reconnects are each handled.
- **A wire format with no raw database ids.** Each arena connection's frame
  carries `isMine`, computed server-side from the session cookie — the same
  pattern `/api/leaderboard`'s `isMine` already used for C8 — rather than
  ever sending a client an internal player id to compare against.

## What is intentionally not implemented yet

- **Observability** (C10): structured logging, metrics, error
  instrumentation. `/api/health` exists as a first, minimal building block,
  not a dashboard.
- **Rooms, matches, or a winner.** The shared arena is continuous and has no
  "start" or "end" condition — a deliberate scope decision
  (ADR-001), not a missing feature.
- No accounts, power-ups, chat, spectating, or AI opponents — out of scope
  for the whole final project this early, not just this week.

## Architecture

```
src/
  game/        pure, deterministic rules: types, movement, collision, food,
               rules (tick/setDirection), state, the result validator, and
               arena (the multiplayer rules: per-player snakes sharing one
               board and one food item, tickArena()) — no DOM, no framework
  frontend/    the only layer that touches the DOM: keyboard input, canvas
               rendering, and the arena client (an EventSource plus its own
               renderer)
  lib/         backend: schema (Drizzle), persistence, session identity,
               and arena-server (the in-memory shared arena, its SSE
               broadcast, and the server-side tick loop)
  pages/       Astro pages (landing, arena, leaderboard, readme) and
               the pages/api/ routes (session, games, leaderboard, health,
               arena/stream, arena/input, arena/respawn)
```

`src/frontend/loop.ts` and `src/frontend/render.ts` were single-player's own
client-side loop and renderer — C9 left them in place rather than replacing
them, since the realtime arena got its own seam instead
(`src/frontend/arena-client.ts`). A later cleanup retired the single-player
route entirely and removed both files along with it, once nothing else
referenced them. `game/*` was unaffected either time: `game/arena.ts` and
`frontend/arena-render.ts` are the separate multiplayer modules that sit
alongside it.

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
schema migration to show up. A multiplayer-arena elimination is persisted
through this exact same table via the same `recordGameResult` function — no
separate schema for it, and no per-tick writes; the arena's live state lives
in memory and only a finished run ever reaches the database.

## API

| Route | Method | Does |
|---|---|---|
| `/api/session` | GET | Mints (or confirms) the caller's anonymous identity; returns `{ displayName }` |
| `/api/games` | POST | Validates and persists a finished game: `{ score, ticks }` → `{ ok, game }` or `400 { ok: false, reason }` |
| `/api/leaderboard` | GET | Top 10 games by score: `{ entries }` |
| `/api/health` | GET | `{ status: "ok" }` if the database is reachable, `503` otherwise |
| `/api/arena/stream` | GET | Opens the realtime channel (Server-Sent Events): joins the caller into the shared arena and streams one `{ gridSize, food, snakes }` frame per server tick |
| `/api/arena/input` | POST | A validated direction change for the caller's own snake: `{ direction }` → `{ ok: true }` or `400` |
| `/api/arena/respawn` | POST | Re-joins the caller as a fresh snake after elimination |

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
`test:unit` first regardless of whether a server is up. `spec/arena.test.ts`
exercises real disconnect/reconnect timing against `ARENA_DISCONNECT_GRACE_MS`
(production default: 5s, picked to outlast a browser `EventSource`'s own
~3s auto-reconnect delay); set it to something short (e.g. `400`) on
whatever process you point `test:spec` at locally, or the disconnect tests
take real minutes rather than seconds — CI's `checks.yml` already does this
for the image it tests. Use **two different browser sessions** (not two
tabs — they'd share one cookie, one identity) to see the arena's
multiplayer behaviour manually.

## How to deploy

```sh
flyctl deploy --remote-only --ha=false -a comp4020-final-januaraine
```

Fly builds `Dockerfile` remotely, runs one `shared-cpu-1x` machine with the
SQLite file on the mounted `/data` volume (`fly.toml`), and serves HTTP on
`$PORT`. Once this repo is public, `.github/workflows/checks.yml` runs the
same deploy on every push to `main`, after `pnpm check` passes against the
built image.
