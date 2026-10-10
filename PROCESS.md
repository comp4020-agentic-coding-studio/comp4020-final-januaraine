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

One real gap: this sandboxed development environment has no browser
installed, so the actual canvas/`EventSource` browser code couldn't be
visually verified here — only its server-side contract. The deployed app
was checked afterward with two genuinely separate browser sessions; see the
final report for what that check actually showed.
