# Process overview

C8 ("it's alive") was built in a single agent-directed session: I gave Claude
Code a detailed brief (scope, acceptance criteria, architecture constraints
for C9/C10, what not to build yet) and had it inspect the repo, plan, and
implement against that brief, then verify each layer before moving to the
next. This file is that account, not a reconstruction after the fact. The
work landed as five commits, one per architectural layer:
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

## Why Astro + SQLite

I'd already worked in this stack for an earlier crit in this course (the
Fly-deployed, server-rendered app with a SQLite volume), so I know its
failure modes and its deploy path. It also fits the course's fixed deploy
shape exactly: one 256 MB machine, one volume, no separate database service.
If C9's concurrent multiplayer writes outgrow SQLite's single-writer model,
that's a new decision record here, not a silent assumption now — a first
stack choice is explicitly allowed to change.

## The architecture decision that matters most: a framework-independent game core

The instruction that shaped every other choice was: C9 adds a server-side
authoritative loop, rooms, and WebSockets, and C8's code has to survive that
without a rewrite. That ruled out the obvious shortcut — one big
`<GameCanvas>`-style client component owning state, input, rendering and
the API call together.

Instead, `src/game/` is a set of pure functions over a `GameState` value:
`movement.ts`, `collision.ts`, `food.ts`, `rules.ts` (`tick`/`setDirection`)
and `state.ts`. None of them touch the DOM, Astro, or the database, and the
one place they'd be tempted to — food placement — takes an injected
`RandomSource` instead of calling `Math.random()` directly. The trade-off is
a bit more indirection for C8 (the frontend loop in `src/frontend/loop.ts`
is a thin adapter rather than where the logic actually lives); the payoff is
that C9's server loop is "import `tick()` and call it from a WebSocket
handler" rather than "find the game logic buried in a component and extract
it under deadline."

## Server-side result validation without server-side replay

The spec says the server can't blindly trust a submitted score. C8 still
runs the game client-side — there's no authoritative loop yet to replay a
match against — so a full replay-based check wasn't available. What is
available is a bound that falls straight out of the rules themselves: `tick`
awards at most one food per call, so a submission's `score / POINTS_PER_FOOD`
can never legitimately exceed its reported `ticks`. That's not a heuristic
threshold tuned by guessing; it's a provable upper bound from the same code
that runs the game. `src/game/validate.ts` checks exactly that, plus the
obvious integer/range sanity checks, and `src/pages/api/games.ts` runs it
before any write.

This is also a deliberately temporary defense: once C9's server runs `tick()`
itself, the score it persists is simply the one it computed, and
`validateGameResult` becomes a sanity assertion rather than the whole
defense. I'd rather ship a real, explainable bound now than a `TODO: replay
validation` comment.

## Survival time in ticks, not client milliseconds

`games.ticks` is the value the client reports and the server checks;
`survival_time_ms` is derived from it server-side (`ticksToMs`) purely for
display. A client's own `performance.now()` reading is something the server
has no reason to trust, and ticks are already the unit the rest of the
system (including `validateGameResult`) reasons about.

## Identity: server-minted, cookie-held, never client-supplied

`src/lib/session.ts`'s `getOrCreatePlayer` is the only place a player row is
created or looked up, and it's driven only by the httpOnly session cookie —
no route accepts a player id from a request body or query string. This is
the same shape I'd use for the owner-token pattern in a resource-booking app:
the credential that says "you may act as this identity" and the identity's
own data are two different things, and only the server ever mints the
former.

## What I deliberately did not build this week

- A dedicated "start game" endpoint. For C8, the server-side precondition for
  "a game can start" is that the player's identity already exists
  (`getOrCreatePlayer` runs before `/play/` renders) — there's no
  server-tracked "game in progress" row yet because there's no authoritative
  loop to track it against. C9 is where "start a game" becomes a real
  server-side event (allocating a room, seeding shared state), and the
  `games.status` column already has room for an `"in_progress"` value when
  that lands, without a schema migration.
- Any WebSocket code, even scaffolding. The brief was explicit that C9
  infrastructure shouldn't show up under the C8 banner, and the game core's
  separation is what's supposed to make that unnecessary — there's nothing
  to "prepare" beyond keeping `src/game/` clean.
- Docker image verification in this exact sandbox: the sandboxed dev
  environment's container runtime can't do a rootless build here (no
  `subuid`/`subgid` mapping for this account), so I verified the thing the
  image actually runs — `pnpm build` then `node ./dist/server/entry.mjs`
  serving all routes and the full API contract correctly — rather than the
  image build itself. The Dockerfile is structurally the same one already
  proven in this course's real CI for an earlier crit.

## Verification

- `pnpm check` (typecheck via `astro check`, 34 pure-logic unit tests in
  `src/game/*.test.ts`, 9 integration tests in `spec/*.test.ts` against a
  running built app) passes clean.
- Manually drove the backend over HTTP: minted two different anonymous
  identities, submitted a valid result and confirmed it on the leaderboard,
  submitted a fabricated score (`999990` from `1` tick) and confirmed it was
  rejected with `400` and never persisted.
- While testing locally I bound the dev server to `0.0.0.0` on this shared
  lab machine and briefly saw an entry on the leaderboard I never submitted —
  almost certainly an external hit against the now-reachable port. No
  private data is at risk (there isn't any — the whole point of this
  identity model is that it carries none), but it's a reminder that `0.0.0.0`
  on a shared host is a real network exposure, not just a localhost
  convenience; I restarted bound to `localhost` for the rest of testing. The
  production Dockerfile binding `0.0.0.0` *inside its own container* is
  correct and unrelated — that's how Fly's proxy reaches it.
