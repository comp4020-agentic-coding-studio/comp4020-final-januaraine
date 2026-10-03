# Working rules for Snake Arena

## Architecture boundary — keep this strict

`src/game/` is pure and framework-independent: no DOM, no Astro imports, no
database, no `Math.random()` called directly (take a `RandomSource` parameter
instead). Every function in it should be callable from a Node script with no
browser and no server. This is not a style preference — C9's authoritative
server loop is meant to import these exact modules unchanged, and C10's
instrumentation wraps around them rather than through them. If a change to
`src/game/` needs `document`, `window`, or a database import, it belongs in
`src/frontend/` or `src/lib/` instead.

## Server-authoritative data, always

- A player's identity comes only from `getOrCreatePlayer(cookies)`
  (`src/lib/session.ts`), which reads the httpOnly session cookie. No route
  may accept a player id, display name, or session token from a request body,
  query string, or form field. If you're tempted to add one, the cookie
  already exists — use it.
- A submitted game result goes through `validateGameResult`
  (`src/game/validate.ts`) before `recordGameResult` ever runs. Don't add a
  second write path to the `games` table that skips it.
- `survival_time_ms` is derived server-side from the submitted `ticks`
  (`ticksToMs`) — never accept it as a client-supplied field.

## Database

- `src/lib/schema.ts` is the ground truth. Change it there, run
  `pnpm db:generate`, and commit the migration in the same commit as the
  schema edit — never hand-edit `drizzle/` or the SQLite file directly.
- Don't log every tick to the database. Persist game-level results
  (`games` rows), not movement history — a tick count is already enough to
  reconstruct duration deterministically given `TICK_MS`.

## Testing

- Pure `src/game/` logic gets unit tests colocated as `src/game/*.test.ts`
  (`pnpm test:unit`, no running server required). Prefer these over an
  integration test whenever the thing under test doesn't actually need HTTP
  or a database.
- `spec/*.test.ts` tests the contract of the deployed app over HTTP
  (`pnpm test:spec`) — what a route must do for any caller, not how it's
  implemented. `spec/invariants.test.ts` stays as shipped.
- Before calling a change done: `pnpm check` green, then actually play a game
  in a real browser and confirm the leaderboard picks it up.

## Scope discipline

C8 is single-player and client-driven on purpose. Don't start building
WebSockets, rooms, or a server-side game loop under the C8 banner — land
those as their own C9 work so the commit history says what milestone each
piece belongs to.
