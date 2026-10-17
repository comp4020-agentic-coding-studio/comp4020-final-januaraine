# Process overview

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

## Zombie player cleanup

The leaderboard accumulates anonymous player rows from local dev/test
sessions that never represented a real visitor — a browser hitting `/arena/`
once and never playing is enough to mint one (`getOrCreatePlayer`,
`src/lib/session.ts`). Over weeks of development this leaves a growing set
of rows with no real score behind them, mixed in with real players' history
in the same `players`/`games` tables.

### Moment: choosing deletion over identity merging, and over IP

1. **What happened:** The obvious instinct for "the same person keeps
   getting a new anonymous id" is to find a stronger identity signal —
   someone suggested IP address — and either merge rows that share it or use
   it as the identity itself.

2. **What I did instead of the obvious thing:** I didn't adopt IP-based
   identity or merging at all. An IP is a property of a network path, not a
   person: it both over-merges (a shared campus/NAT connection, or two
   people on the same hostel WiFi, would collapse into one "player") and
   under-merges (switching from WiFi to mobile data changes it, same
   problem this was meant to solve). More importantly, nothing in this
   schema has a signal that reliably says "these two anonymous rows are the
   same human" — guessing at a merge risks splicing one person's real score
   onto someone else's history, which is worse than leaving a zombie row
   alone. So the design only *deletes* identity it's confident adds no
   value (see the activity rule below), and never merges anything.

3. **How I knew it was right:** deletion is the one operation here that can
   only lose information, never fabricate it — a wrong delete loses a score
   that could in principle be restored from a backup; a wrong merge
   silently corrupts two people's history into one with no way to tell
   afterwards which parts belonged to whom. Given the choice, the
   reversible-mistake failure mode is the one to build around.

### Moment: not trusting `createdAt` as a proxy for "last active"

1. **What happened:** `players` has no `lastActiveAt` column — only
   `createdAt`, set once at signup. The brief instinct for "90 days
   inactive" is to filter on `createdAt < now - 90d`, but that measures how
   long ago the *row* was created, not how long ago anyone actually played.

2. **What I did instead of the obvious thing:** I read `src/lib/schema.ts`
   and `src/lib/db.ts` first rather than assume a field existed, confirmed
   no activity timestamp is tracked on `players`, and derived "last
   activity" per player instead of reading it off one column: the most
   recent `games.finishedAt` for a player with at least one game, and only
   `createdAt` — reported separately as a lower bound, not disguised as
   real activity — for a player with zero games. A player who signed up
   once and kept playing is never misjudged as stale just because their
   *account* is old; a player who never played at all is the one case
   where there's also no real score at risk from a wrong call.

3. **How I knew it was right:** I ran the derivation against the real local
   `.data/app.db` (203 players, 92 games) before trusting it, and separately
   confirmed on a disposable copy that a stale-but-still-top-30 player
   survives a near-zero cutoff — the leaderboard-membership guard (below)
   overriding a 90-day-old timestamp was the case most likely to go wrong
   silently, so it's the one I checked by hand rather than by reading the
   SQL and assuming it was right.

### Moment: a hard safety net beyond the activity rule itself

1. **What happened:** A 90-day inactivity rule alone can still delete a
   real player's best-ever run if they never came back to play again — rare,
   but real, and the leaderboard is this project's one piece of player-
   facing persistent state.

2. **What I did instead of the obvious thing:** The cleanup script computes
   the same Top 30 ranking `listLeaderboard` uses for the public page and
   excludes every one of those players from deletion outright, regardless
   of how stale their last game is. "Still shown on `/leaderboard/` right
   now" is a harder, more legible guarantee than any time-based heuristic:
   nothing currently visible to a visitor can be deleted by this script.

3. **How I knew it was right:** dry-run output against the real dataset
   lists exactly who the top-30 guard protects (e.g. a 90000+/60-day-old
   personal best) separately from the players actually slated for deletion,
   so the guard's effect is visible before anything runs, not just asserted.

### Moment: finding a real bug by actually running `--apply`

1. **What happened:** The first `--apply` run against a populated test
   database failed with `FOREIGN KEY constraint failed`, not the happy path
   I'd written the script against.

2. **What I did instead of the obvious thing:** Rather than special-case
   around the error or weaken the delete, I traced it to
   `rooms.creator_player_id`'s foreign key on `players.id`: `rooms` is only
   truncated at server boot (`db.ts`'s own comment says so explicitly — a
   deliberate consequence of room state living in memory, not a bug), so a
   zombie player who once created a room between restarts still has a live
   `rooms` row pointing at them. `deletePlayerPermanently` in `src/lib/db.ts`
   has this exact same latent gap — it isn't new here, this script just hit
   it first. I added a `DELETE FROM rooms WHERE creator_player_id = ?` into
   the same per-player transaction, consistent with `db.ts`'s own framing of
   room metadata as disposable rather than real history.

3. **How I knew it was right:** re-running `--apply` against the same test
   database succeeded, and a follow-up query confirmed zero orphaned rows in
   either `games` or `rooms` afterward. I did not fix this by reasoning about
   the schema in the abstract — I only found it because I ran the apply path
   for real against data shaped like production (a server that had actually
   created rooms), rather than trusting the dry-run path alone.

### What actually got built

- `scripts/cleanup-zombie-players.ts`: a standalone maintenance script, not
  an HTTP route — there is no API for this anywhere in the app, matching
  `CLAUDE.md`'s "no second write path" rule for player deletion. Opens the
  SQLite file directly with `better-sqlite3` (deliberately not through
  `src/lib/db.ts`, which runs a migration and truncates `rooms` as a side
  effect of being imported at all, and always opens a read-write handle).
  Defaults to a dry-run preview; `--apply` is required to delete anything,
  and takes an online `backup()` (WAL-safe, unlike copying the file) before
  writing.
- `package.json`: `pnpm cleanup:zombies` runs it via `tsx` (added as a
  pinned devDependency at the version already resolved transitively through
  Astro's own toolchain, so no new major dependency was introduced).
- `src/pages/leaderboard.astro`: a `.filters-note`-styled line under the
  page's subtitle (same muted, secondary style already used for the active-
  filters summary) telling players an inactive anonymous account may be
  cleaned up after 90 days, so the deletion policy isn't a silent backend
  decision.

### Verification

`pnpm typecheck` (astro check, 0 errors) plus a standalone `tsc --noEmit` of
the script against the project's own `tsconfig.json` (`astro check` doesn't
cover `scripts/`), `pnpm test:unit` (91/91) and a full `pnpm build` +
`test:spec` run (59/59) all pass unchanged. The script itself was exercised
end to end against disposable copies of real data — never the live
`.data/app.db`, never anything deployed: dry-run and `--apply` against a 203-
player/92-game snapshot, and again against a server freshly populated by the
spec suite's own room/game traffic (to get real `rooms` rows into the test),
confirming in both cases that the Top-30 guard holds, the pre-delete backup
is byte-for-byte the prior row count, and no orphaned `games` or `rooms` rows
remain after a delete.

