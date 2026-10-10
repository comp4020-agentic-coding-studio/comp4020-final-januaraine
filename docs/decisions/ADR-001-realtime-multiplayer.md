# ADR-001: One server-authoritative shared arena

## Status

Accepted — implemented for C9
([`8accb31`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-januaraine/compare/8accb31...6fbac48)).

## Context

C8 shipped a single-player, client-driven Snake game. C9 requires the
deployed app to behave correctly when more than one anonymous player uses
it *at once*: a change one player makes has to reach every other open
session in about a second, with no reload, and the server — not any
browser — has to be the one deciding what actually happened (position,
collisions, food, score, game-over).

That forces one unavoidable design question before any networking code:
**what does "at once" mean for this specific game?** Three shapes were on
the table.

## Options considered

1. **One shared arena.** Every connected player sees and affects the same
   board, the same food, the same set of other snakes, all the time. No
   lobby, no "start," no winner — a continuous shared space, closer to an
   arcade machine than a tournament bracket.
2. **Separate rooms/matches.** Players ready up, a room starts when enough
   people are in it, it runs to a "last survivor" or score-timer ending,
   declares a winner, and resets. This is what
   `docs/Snake_Arena_Final_Project_Technical_Design.md`'s §11–12 originally
   sketched (`WAITING → RUNNING → FINISHED → RESULTS`).
3. **Independent client simulations, periodically reconciled.** Each
   browser runs its own authoritative-feeling loop and the server
   periodically corrects divergence. This is the classic shortcut for
   latency-hiding in competitive games, and the one the brief and the
   design doc both explicitly warn against: "the client should NOT be
   authoritative for... final player position [or] collision results."

Option 3 was ruled out immediately, not chosen-against after a trial: it
directly contradicts §5/§8/§32 of the technical design doc and the C9
spec's own "the server is authoritative" requirement, and it would mean
running `src/game/*`'s pure logic twice — once per client, once on the
server — and reconciling disagreements, which is strictly more mechanism
for a worse guarantee than just running it once, on the server, and
broadcasting the result. No prototype of it was built; it fails on
contradiction with a stated constraint, not on a benchmark.

Options 1 and 2 were both genuinely viable. Option 2 is what the earlier
design doc sketched, and it's closer to "a real multiplayer game." But it
also adds a second state machine (room lifecycle) layered on top of the
one that already matters (a snake's own alive/dead state), a "start
condition" that has to handle someone joining mid-countdown, a winner
concept that this grid-eat-food-avoid-walls game doesn't otherwise need,
and a reset/rematch flow. None of that is free, and the course brief is
explicit: "Do not build a complex matchmaking system unless the existing
architecture makes it necessary." It doesn't.

## Decision

**Option 1: one continuous shared arena, per-player elimination.**

There is exactly one arena, held in one process's memory
(`src/lib/arena-server.ts`). Opening `/arena/`'s SSE connection joins it
immediately — no ready-up, no waiting room. A player's turn ends only
when their own snake is eliminated by a collision rule (wall, self, or
another snake); that persists their run through the *existing*
`recordGameResult` path, exactly like single-player's client-submitted
result does, just server-computed instead of client-reported. They can
then respawn into the same arena immediately. Nobody ever "wins" a match,
because there is no match — only runs, each one a row on the one shared
leaderboard.

## Why this fits this README's definition of "good"

C8's README defines good as Responsive, Understandable, Fair, **Social**
("the presence of other players should materially affect gameplay"),
**Reliable** ("disconnects and invalid inputs should not destroy the
entire room"), and Persistent. A single shared arena is the most direct
reading of *Social* available: every player is, by construction, in the
same place as everyone else, all the time — there's no lobby screen
between "opened the site" and "other people are affecting my game." It is
also the most direct reading of *Reliable*: there is no "room" to
destroy, because there's no room-scoped state at all beyond one player's
own snake — one player's disconnect, bad input, or elimination can only
ever remove their own entry from `state.snakes`, never anyone else's.

A round-based room system would arguably read as "more of a game," but it
would do that by adding exactly the kind of state (ready flags, a start
condition, a winner, a reset) that C8's own README already committed to
treating as scope to add only when the architecture requires it — and it
doesn't, for the same reason single-player didn't need matchmaking:
the game is small, the deploy is one process, and the thing C9 actually
has to prove is "a change propagates," not "a tournament runs."

## Costs and limitations

- **No winner, no match summary.** If a future crit wants a "who's
  currently leading" framing, that's additive (a scoreboard sort, already
  visible in the players list), not a redesign — but it's explicitly not
  here now.
- **One process, one arena, no horizontal scaling story.** This is
  acceptable *because* `fly.toml` runs exactly one `shared-cpu-1x`
  machine with `--ha=false` — there is no second instance for arena state
  to need to agree with. If a future crit requires multiple machines,
  this decision would need revisiting (a pub/sub broadcast layer, or
  sharding rooms across instances) rather than simply continuing to work.
- **A disconnected player's snake keeps moving.** See below — this is a
  deliberate, documented trade-off, not an oversight.
- **No spectator-only view.** Opening `/arena/` joins you as a snake.
  Watching without playing isn't a supported mode (not required by the
  brief, and out of scope per "what not to build initially").

## Simultaneous inputs, disconnects, and reconnections

- **Simultaneous direction changes.** Each player's input only ever
  writes to their own `pendingDirection` (`setArenaDirection`, keyed by
  player id); Node's single-threaded event loop processes one HTTP
  request or one tick at a time, so two players' near-simultaneous POSTs
  can never interleave mid-write. This isn't a lock I had to build — it's
  a property of the runtime, and `src/game/arena.test.ts` covers that one
  player's queued direction never affects another's.
- **Two heads moving onto the same cell.** Resolved as a rule, not a race:
  both are eliminated (`tickArena`'s head-to-head check), computed from one
  consistent pre-move snapshot of the whole board, not from whichever
  player's request happened to be handled first.
- **A client disconnecting during a game.** The SSE connection closing
  starts a short grace timer (`arena-server.ts`'s `DISCONNECT_GRACE_MS`,
  production default 5s — chosen to comfortably outlast a browser
  `EventSource`'s own default auto-reconnect delay, so an ordinary network
  blip resolves before the server gives up on it) rather than removing the
  player immediately. If no other connection is open for anyone, the
  server tick loop itself stops (`stopTickLoopIfIdle`), so a lone
  disconnected player's snake simply freezes rather than wandering into a
  wall unwatched. If *other* players are still connected, the loop keeps
  running, and a disconnected player's snake keeps moving under its last
  queued direction — the same as it would if they just stopped pressing
  keys — and can be legitimately eliminated (and persisted) while they're
  away. Both behaviours were exercised directly: `spec/arena.test.ts`'s
  disconnect test isolates the "nobody else connected" case and confirms
  no result is persisted for a plain abandonment; the elimination test
  exercises an unsteered snake actually hitting a wall and persisting.
- **A client reconnecting while the game is still running.** Opening a
  new SSE connection for a player who still has a live snake is a no-op
  join (`joinArena` is idempotent) plus cancelling any pending grace timer
  — same code path as a first join, not a special case. Their snake,
  score, and position are exactly as the server left them; nothing is
  reconstructed from the client.
- **A player joining after the arena has been running a while.** Not a
  special case either — there is no "has the game started" condition to
  satisfy. They spawn into whatever the shared board currently looks
  like.
- **Duplicate connections for one player (two tabs, same cookie).** Both
  are just read-only broadcast recipients of the same one snake; input
  from either tab moves the same snake, because identity is the session
  cookie, not the connection. This is a consequence of the existing
  anonymous-identity model (one cookie = one player), not something new
  this decision introduces.

## Evidence

- `src/game/arena.test.ts`: the collision/food/direction rules above,
  unit-tested directly against the pure `tickArena` function.
- `spec/arena.test.ts`: the same rules proven over real HTTP/SSE against
  the built app — two distinct cookies get distinct identities and see
  each other; a direction change posted by one is observed by another
  live connection in well under a second (measured); a forced wall
  collision persists through the leaderboard; a disconnect with no
  reconnect is removed without persisting; a reconnect inside the grace
  window resumes the same snake. All of this was also exercised by hand
  against a local dev server with two independent session cookies before
  the automated tests were written, to make sure the manual check and the
  automated one agreed.
- **Not done:** no load test, no measurement under more than a handful of
  concurrent connections, no test of behaviour across a machine restart
  mid-game (arena state is memory-only by design — a restart simply
  starts a fresh, empty arena, which is consistent with "don't persist
  every tick" but is not separately verified here). These are honest gaps
  in the evidence, not claims being made past what was actually checked.
