# Process overview

## What I built

Snake Arena is a browser-based, real-time multiplayer Snake game built around anonymous players, shared rooms, and a persistent leaderboard. The idea was to take a familiar single-player game and turn it into a shared experience where players can join the same room, control their own snakes, watch other players in real time, and compete without creating an account. C9 focused on making concurrent play work reliably while keeping the game understandable and accessible across desktop and mobile devices.

## The moments that mattered

### Moment 1: Moving from solo play to a shared, real-time arena

1. **What happened:** The project evolved from a single-player Snake game into a room-based multiplayer game. This introduced problems that do not exist in solo play: multiple players must see a consistent arena, player inputs must be handled safely, and updates must reach other connected sessions without requiring a page reload.

2. **What you did instead of the obvious thing:** Rather than treating each browser as the owner of its own game state, I used the server as the authority for shared arena state. Clients send inputs, while the server processes game progression and distributes updates. This makes the shared game state less dependent on individual clients and gives newly connected or reconnected sessions a way to recover the current state.

3. **How you knew it was right:** I checked the multiplayer behavior through the existing room tests and local multi-session testing, focusing on whether different clients could observe the same room and whether state updates propagated without reloading. The important success criterion was not simply that the game worked in one browser, but that independent sessions could participate in the same live game.

4. **The citation:** [8accb31...d121156](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/8accb31...d121156)


### Moment 2: Treating multiplayer edge cases as part of the game design

1. **What happened:** Multiplayer introduced lifecycle and consistency questions beyond the basic Snake movement rules. A player can be eliminated while other players continue playing; viewers may remain after players leave; and disconnected clients may need to recover the current room state.

2. **What you did instead of the obvious thing:** I did not treat these cases as ordinary single-player game-over behavior. The server remains responsible for authoritative game state, while each client presents the appropriate view for its own role and status. Room lifecycle rules also distinguish active players from viewers, rather than assuming that anyone still viewing a room means it should remain active.

3. **How you knew it was right:** I examined the room lifecycle and elimination behavior against the intended multiplayer experience, and used tests to investigate failures rather than assuming every failed test meant the production game logic was broken. This helped separate actual implementation defects from timing-sensitive test assumptions.

4. **The citation:** [1af35d2...4b4330d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/1af35d2...4b4330d)

### Moment 3: Making the development process more reliable through targeted verification

1. **What happened:** Testing exposed a flaky room test: a snake could spawn close to a wall and be eliminated by normal movement before a timing-dependent assertion ran. Repeated local runs showed that the failure was intermittent rather than a deterministic failure of the intended behavior.

2. **What you did instead of the obvious thing:** Instead of simply increasing timeouts or immediately changing production game rules, I investigated the cause and separated test reliability from game-design decisions. The test was adjusted to account for the random spawn position, and the affected test suite was run repeatedly to check whether the fix addressed the race.

3. **How you knew it was right:** Type checking was clean, and the room test was stress-tested over 20 repeated runs after the changes. This provided stronger evidence than relying on a single successful test run. The lesson was that a green test result is useful only when the test itself reliably measures the behavior it is intended to verify.

4. **The citation:** [b527db1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/b527db1) 
[1af35d2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/commit/1af35d2)

## C10 — Observability

C10 asks for exactly one thing: can the developer tell what the system is
doing and diagnose a failure, via structured logs and a small set of
runtime metrics — not a monitoring platform. This landed as one new module
(`src/lib/observability.ts`: a `logEvent()` that writes a structured JSON
line per meaningful transition, and a handful of in-memory counters), wired
into the existing event sites in `src/lib/room-server.ts` and `src/lib/db.ts`,
plus a new `GET /api/metrics` endpoint built the same way `/api/health`
already is.

### Moment: adapting the brief's event vocabulary to what's actually built

1. **What happened:** The technical design doc's own suggested event/metric
   names (`websocket_error`, `game_started`, a `gameId`-keyed payload) were
   written for a generic WebSocket/match-based multiplayer shape. This app
   is neither: ADR-001 chose Server-Sent Events over WebSockets, and
   ADR-002–004 chose a continuous room (no "match," no winner, no
   start/end) over a bracketed game.

2. **What I did instead of the obvious thing:** Rather than force the
   doc's literal names onto a transport and lifecycle model that doesn't
   have them, the event vocabulary was adapted to what this app actually
   runs: `sse_error` instead of `websocket_error`, `roomId` as the unit of
   concurrency instead of `gameId`, and no `game_tick` event at all — only
   one log line per *meaningful* state transition (join, leave, food
   eaten, elimination, finish, room open/close), matching the design doc's
   own stated goal of not building "a huge monitoring platform." The same
   reasoning dropped `api_latency` from the metrics list: nothing in a
   local-SQLite, fire-and-forget-SSE stack has a latency number anyone
   would act on yet.

3. **How I knew it was right:** The design doc states its own success
   criterion in plain language — "who is connected, which room, is a game
   running, what happened, when, did the realtime channel fail" — and
   every one of those questions is answerable from the adapted event set
   without a single per-tick log line. Keeping the names honest to the
   actual architecture (SSE, rooms) rather than the doc's placeholder
   terms is also what keeps this consistent with every other ADR in this
   project, all of which record a deliberate departure from the original
   design sketch rather than silently diverging from it.

4. **What `food_collected` attribution needed:** Doing this properly meant
   `game/arena.ts`'s pure `tickArena()` had to additionally report *who*
   ate each food item this tick (it already knew the index internally, just
   never returned it) — a small, additive `eaten` field on `ArenaTickResult`,
   with no new I/O, no DOM, and no change to any existing collision/movement
   logic, keeping `CLAUDE.md`'s architecture boundary intact: C10's
   instrumentation still wraps around `src/game/`, this is just exposing
   data the pure core already computed.

### What actually got built

- `src/lib/observability.ts`: `logEvent()` (structured JSON to stdout,
  readable via `flyctl logs`) and a small in-memory counters object,
  exported as `getCounters()`.
- `src/game/arena.ts`: `ArenaTickResult` gained `eaten: { playerId, source }[]`,
  populated inside `tickArena()`'s existing food-consumption pass — pure,
  additive, unit-tested in `src/game/arena.test.ts`.
- `src/lib/room-server.ts`: every join/leave/role-change/connect/disconnect/
  room-open/room-close call site now logs its event; `runTick()` logs
  `food_collected` (from the new `eaten` field) and
  `player_eliminated`/`game_finished` for every validated elimination, and
  logs a `database_error` diagnostic (rather than silently dropping the
  result) on the one case `validate.ts` says should never happen once the
  server runs the tick loop itself. Three small gauge helpers
  (`activeRoomCount`, `totalActivePlayerCount`, `totalActiveConnectionCount`)
  read the existing room registry directly — no new state to keep in sync.
- `src/pages/api/metrics.ts`: a new unauthenticated `GET` endpoint, same
  posture as `/api/health` (nothing in these counts is sensitive for an
  anonymous small-web app), combining the live gauges and the accumulated
  counters into one JSON response.
- `src/lib/db.ts`: the boot-time `migrate()` call and the two unexpected-
  error rethrow paths (`createRoom`, `recordGameResult`) now log a
  `database_error` line before rethrowing — the project already never
  swallows a raised error, this just makes the rethrow show up in the
  structured log too.
- `spec/metrics.test.ts`: drives `/api/metrics` over real HTTP against the
  built app, checking the response shape and that `activeRooms`/
  `activePlayers`/`gamesStarted` move correctly across a real room
  create/leave cycle.

### Verification

`pnpm typecheck` (0 errors), `pnpm test:unit` (91/91, including the
extended `arena.test.ts` assertions on the new `eaten` field), and
`pnpm check` against the built app (all spec suites, including the new
`spec/metrics.test.ts`) all pass. Manually: ran the built server in the
foreground and drove a room through `curl` (create → join → move → eat →
collide → eliminate), confirming the JSON log lines appeared in the
expected order and `/api/metrics`'s counters moved accordingly — the exact
Phase 7 deliverable ("show corresponding logs/instrumentation for this
flow"). The same pre-existing sandbox gap from C9 (no browser here) applies
again: a two-independent-browser-session walkthrough of the same flow,
watching both the log stream and `/api/metrics` live, is listed as what the
user still needs to do locally.

