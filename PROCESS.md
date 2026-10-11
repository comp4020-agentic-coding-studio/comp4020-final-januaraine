# Process overview

How this got from the brief to the app in the repo, told across the two
milestones it's actually been built in.

## C8 — the single-player core (previous session)

Built in one agent-directed session: a detailed brief (scope, acceptance
criteria, and the C9/C10 architecture constraints that scope had to survive),
then inspect → plan → implement → verify, one architectural layer per commit:
[`30720db`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/30720db)
(stack scaffolding and Fly deploy config),
[`5dcd4af`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/5dcd4af)
(the framework-independent game core and its unit tests),
[`cca89a0`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/cca89a0)
(backend: schema, persistence, session identity, API routes),
[`1038c2c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/1038c2c)
(frontend: input, rendering, loop, pages), and
[`12e6e18`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/12e6e18)
(the integration spec).

Two decisions from that session mattered enough to still shape C9 directly:

**A framework-independent game core.** The instruction that shaped every
other C8 choice was that C9 would add a server-side authoritative loop and
realtime networking on top, without a rewrite. `src/game/` ended up as pure
functions over a `GameState` value — `movement.ts`, `collision.ts`,
`food.ts`, `rules.ts`, `state.ts` — none of them touching the DOM, Astro, or
the database, with even food placement taking an injected `RandomSource`
instead of calling `Math.random()` directly. That paid off directly this
session: C9's `src/game/arena.ts` reuses `hitsWall`/`hitsSelf`/
`nextHeadPosition`/`isValidDirectionChange`/`randomEmptyCell` unchanged
rather than re-deriving any of them.

**Server-side result validation without server-side replay.** C8 ran the
game client-side, so it couldn't replay a match to check a submitted score —
but `tick()` awards at most one food per call, so `score / POINTS_PER_FOOD`
can never legitimately exceed the reported `ticks`; `src/game/validate.ts`
checks exactly that bound. That file's own comment already anticipated this
week: once a server runs `tick()`-equivalent logic itself, the score it
persists is simply the one it computed, and the bound becomes a sanity
assertion rather than the whole defense — which is exactly how
`src/lib/arena-server.ts` uses it now.

## C9 — real-time multiplayer (this session)

### What I inspected before changing anything

README.md's C8 "what good means" section, the whole of `src/game/`,
`src/frontend/`, `src/lib/`, `src/pages/api/`, the Drizzle schema and
migrations, the anonymous session-cookie identity mechanism, `spec/*`,
`astro.config.ts`/the `@astrojs/node` adapter's actual source (to find out
whether it exposes a raw HTTP server for a WebSocket upgrade — it doesn't, in
`mode: "standalone"`, without ejecting it), `Dockerfile`/`fly.toml`/
`.github/workflows/checks.yml`, and the git history. There was no realtime
channel, no multi-snake state, and no server-side game loop anywhere in the
repo — C8 was exactly what its own README said it was.

### Transport: Server-Sent Events, not WebSockets

The brief leaves the transport to "mostly settled by your stack," and this
stack settles it toward SSE: the Astro node adapter's standalone mode owns
its own `http.Server` internally and doesn't expose it for a raw WebSocket
`upgrade` without ejecting the adapter (a custom entry script, a Dockerfile
`CMD` change, separate dev-mode wiring). A plain streaming `Response` needs
none of that and behaves identically under `astro dev` and the built
server. A live Fly.io community report from this year of WebSocket-upgrade
requests failing with edge-level 403s for reasons unrelated to the
application was the deciding factor against the alternative on a
course deadline — not a benchmark, a risk assessment, made explicit here
rather than silently assumed.

### The shared arena

One continuous arena, not rooms or matches — the full reasoning, alternatives
considered, and trade-offs are in
[`docs/decisions/ADR-001-realtime-multiplayer.md`](docs/decisions/ADR-001-realtime-multiplayer.md).
In short: a shared arena is the most direct reading of this README's own
"Social" and "Reliable" definitions of good, and a room/match lifecycle would
add exactly the kind of state (ready flags, a start condition, a winner,
a reset) the brief says not to build unless the architecture requires it —
it doesn't, for a one-process, `--ha=false` deploy.

### What actually got built

- `src/game/arena.ts` + `arena.test.ts`
  ([`8accb31`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/8accb31)):
  pure multiplayer rules — join/leave, per-player direction queuing, one
  `tickArena()` step resolving wall/self/snake-vs-snake collisions (including
  mutual head-to-head) against one consistent pre-move snapshot, shared food.
- `src/lib/arena-server.ts` + the `/api/arena/*` routes
  ([`ec1d18f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/ec1d18f)):
  the one in-memory arena (one Fly machine, one process — no pub/sub to
  build), a tick interval that only runs while someone's connected (so
  `fly.toml`'s `auto_stop_machines` still works), and eliminated runs
  persisted through the *existing* `recordGameResult` path, server-computed
  instead of client-submitted. The wire format never sends a raw player id —
  each connection's frame carries `isMine`, computed server-side from the
  session cookie, the same pattern the leaderboard's `isMine` already uses.
- `/arena/` + `src/frontend/arena-client.ts`/`arena-render.ts`
  ([`c3db583`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/c3db583)):
  a new page and new render/client modules, not a change to `/play/`'s —
  single-player is untouched.
- `spec/arena.test.ts`
  ([`6fbac48`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/6fbac48)):
  the same claims proven over real HTTP/SSE against the built app, including
  a measured "well under a second" propagation assertion, not just an
  unverified target.

### Verification

Before writing the automated spec tests, I drove the backend by hand: two
independent session cookies (not two tabs of one session) against a local
dev server, over raw HTTP/SSE via `curl`. Both players appeared to each
other from the very first frame with distinct identities; a direction
change POSTed by one showed up in the other's own stream on the next tick
(~120ms); an unsteered snake's wall collision removed it from both views at
once and produced a leaderboard row; a disconnect that reconnected inside
the grace window resumed the same snake, while one that didn't was removed
with no leaderboard row created. `pnpm check` (typecheck, unit, and the full
spec suite including the new arena tests) passes against the built app on a
scratch database, run twice to rule out flakiness.

Two real gaps in local verification, both pre-existing limits of this
sandboxed environment rather than anything new this week: it has no browser
installed, so the actual canvas/`EventSource` browser code couldn't be
visually checked here, only its server-side contract over raw HTTP/SSE; and
its container runtime can't do a rootless Docker build (no `subuid`/
`subgid` mapping for this account — confirmed again this session), so the
exact image CI builds and Fly deploys wasn't built locally either. What was
verified instead, both times, is the thing the image actually runs:
`pnpm build` then `node ./dist/server/entry.mjs` serving every route,
including the new arena ones, correctly. CI building and running the real
Dockerfile, and the live deployed app checked with two genuinely separate
browser sessions, are what closes both gaps; see the final report for what
those actually showed.

## C9 continued — room-based multiplayer (this session)

The brief for this milestone changed from C9's original "one continuous
shared arena" to room-based multiplayer: a lobby, named/searchable rooms,
a 5-Player cap per room with unlimited Viewers, independent lock/viewer
flags, and a live preview. This supersedes ADR-001's "no rooms" decision —
[ADR-002](docs/decisions/ADR-002-room-based-multiplayer.md) records why,
and what didn't change (the SSE+POST transport, server authority, the
disconnect-grace pattern, all reused unmodified).

### What I inspected before changing anything

The working tree first: `git status`/`git diff` turned up unrelated
uncommitted work already present (a light/dark theme toggle across every
page, and a `listLeaderboard` bugfix moving `LIMIT` before the sort) —
neither touched or reverted, both left exactly as found. Then the actual
C9 implementation: `src/game/arena.ts` and its tests (the pure multiplayer
rules — confirmed these generalize to "one `ArenaState` per room" with no
changes needed at all), `src/lib/arena-server.ts` (the single-arena
runtime being replaced), the `/api/arena/*` routes, `arena.astro`,
`arena-client.ts`/`arena-render.ts`, `spec/arena.test.ts`, the Drizzle
schema/migrations, `session.ts`'s identity model, `fly.toml`/`Dockerfile`
(confirmed the single-instance, `--ha=false` assumption rooms would also
need to rely on), and the original design doc's own rooms sketch (§11) for
terminology, without treating it as binding — ADR-001 had already departed
from it once, deliberately.

### What actually got built

- **Schema**: a `rooms` table (`src/lib/schema.ts`,
  `drizzle/0003_fancy_random.sql`) — name, a separate case-insensitive
  `nameKey` carrying the actual uniqueness constraint, creator, `locked`,
  `allowViewers`. `db.ts` truncates this table once at boot (see ADR-002's
  "costs" section for why that's deliberate, not a bug) and gained
  `createRoom`/`findRoomById`/`deleteRoom`/`listRooms` alongside the
  existing player/game/leaderboard functions.
- **`src/lib/room-server.ts`** replaces `arena-server.ts`: a
  `Map<roomId, RoomRuntime>` where each runtime wraps one *unchanged*
  `game/arena.ts` `ArenaState` plus a `Map<playerId, Member>` for
  roles/connections, a per-room tick loop (same idle-stop behavior as
  before, now per room), and the per-player disconnect-grace timer
  generalized to also decide room closure when the departing member is
  the creator.
- **Routes**: `src/pages/api/rooms/{index,stream}.ts` (lobby list/create,
  and a throttled SSE feed with authorization-checked previews) and
  `src/pages/api/rooms/[id]/{stream,join,input,become-player,become-viewer,respawn,leave}.ts`.
  The old `/api/arena/*` routes are deleted.
- **Pages**: `arena.astro` rewritten as the Arena Lobby (search, Create
  Room, room cards, a role-selector dialog); `room/[id].astro` added for
  the room game view (canvas, D-pad gated to Players only, separate
  Players/Viewers lists, role-switch/leave/death actions). `play.astro`
  is untouched; only its nav link is gone from every page, per the brief
  ("do not delete reusable game-engine code").
- **Frontend**: `room-client.ts` and `lobby-client.ts` added;
  `arena-client.ts` deleted (its logic is what `room-client.ts`
  generalizes); `arena-render.ts`/`dpad.ts`/`input.ts` reused unchanged
  for both the room canvas and the lobby's mini previews.
- **Tests**: `spec/arena.test.ts` replaced by `spec/rooms.test.ts` — 15
  integration tests over real HTTP/SSE: unique names (incl.
  case-insensitive collision), create+search, the 5-Player cap with
  unlimited Viewers, locked-room Player-join rejection (while the creator
  can still play), viewer-permission rejection, lobby preview
  authorization (a locked or no-viewer room's id, even explicitly
  requested, never comes back with preview data), Viewer→Player
  switching (including rejection once full), elimination/respawn/become-
  viewer/leave without ending the game for others, creator-departure
  closing the room (both an explicit leave and a disconnect past the
  grace window), a genuine concurrent race for the last Player slot (two
  real simultaneous requests, exactly one wins), real-time propagation
  between two independent sessions in under a second, a Viewer's input
  being silently ignored rather than moving anyone's snake, and
  reconnect-resumes-the-same-membership. `src/game/arena.ts`'s own unit
  tests are untouched and still pass unmodified, since the game core
  itself needed no changes.

### A bug the tests themselves caught

`spec/rooms.test.ts` revealed two real bugs before they'd have
reached the app:

1. An early version of `joinRoom` tore down *any* existing membership
   (via a generic "leave your current room first" step) before adding
   the new one — including when the "new" membership was just a role
   switch within the *same* room. Since leaving a room as its creator
   closes it, a creator calling "Join as Player" again after becoming a
   Viewer would have closed their own room out from under themselves.
   Caught by code review before the tests even ran, not by a failing
   test — fixed by excluding the room being joined from that cleanup
   step.
2. A test-only bug, not an app bug: one room name in the test file ("…
   Locked But Watchable …" plus its uniqueness suffix) exceeded the
   server's own 40-character room-name cap, so the room was never
   created and the real assertion never got exercised — it failed with
   "room name must be 1-40 characters" instead of the issue it was meant
   to catch. Shortened the label; the cap itself (a deliberate, modest
   bound on a user-supplied name) was correct as written.

Also caught in manual verification, not by an automated test failing
loudly: a bodyless `POST` (become-player/become-viewer/respawn/leave)
sent without a `content-type` header tripped Astro's CSRF origin check
in this sandboxed test environment, where `fetch` sends no `Origin`
header at all. `leaderboard.astro`'s own delete-my-data request already
documents the fix in a comment — `content-type: application/json` marks
a request as script-driven regardless of body — applied to both the test
helpers and the production `room-client.ts`/`lobby-client.ts` fetches.

### Verification

`pnpm typecheck` (`astro check`, 0 errors across 60 files) and
`pnpm test:unit` (57/57, including all of `src/game/arena.test.ts`
unmodified) pass. `pnpm build` succeeds; the built server
(`node ./dist/server/entry.mjs`, `ARENA_DISCONNECT_GRACE_MS=400` the same
way CI shortens it) serves every route including the new room ones.
`pnpm check` — the project's own full gate — passes end-to-end: 57 unit
tests, 46 spec tests (the new 15-test `spec/rooms.test.ts`, plus
`spec/leaderboard.test.ts`, `spec/games.test.ts`, and
`spec/invariants.test.ts` rerun unmodified as a regression check, all
still green).

The same two pre-existing sandbox gaps from the earlier C9 entry still
apply and aren't closed by this session: no browser here to visually
exercise the lobby dialog/room canvas/D-pad by hand, and no rootless
Docker build to prove the exact deployed image. Both of those, plus an
actual two-independent-browser-session check of rooms specifically (the
brief is explicit that two tabs sharing one cookie don't count), are
listed as what the user still needs to do locally — see the final
report's testing instructions. Nothing in this session was committed,
pushed, or deployed; that stayed the user's explicit call throughout.
