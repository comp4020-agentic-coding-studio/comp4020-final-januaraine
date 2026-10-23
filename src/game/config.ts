// Shared between the client's own loop (C8) and, eventually, the
// authoritative server loop (C9) — both have to agree on these numbers for
// the server's result validation (validate.ts) to mean anything. A single
// source of truth here is what makes "move the loop server-side" a swap of
// where tick() runs, not a redesign of what it computes.

// Board is gridSize × gridSize cells.
export const GRID_SIZE = 20;

// One tick is one cell-step of the snake. Fixed-rate, not frame-rate: this is
// what lets survival time be measured in ticks (an integer, replayable count)
// rather than wall-clock milliseconds a client could misreport.
export const TICK_MS = 120;

// Flat award per food — score is always an exact multiple of this, which is
// part of what the server checks a submitted result against.
export const POINTS_PER_FOOD = 10;

// A generous ceiling on a single reported game, in ticks — long enough for
// any real match, short enough to keep a hand-built request from claiming a
// multi-day survival time. (~1 hour at TICK_MS=120.)
export const MAX_TICKS = 30_000;

// How long an eliminated snake's body stays on the board, faded out but not
// yet collectible, before converting to food — the same tick clock as
// gameplay itself rather than a second client-side timer, so every Player
// and Viewer sees the exact same fade regardless of connection timing.
// 4 * TICK_MS = 480ms, inside the ~400-600ms the brief asks for.
export const DEATH_FADE_TICKS = 4;

// How long a death-food cell stays on the board before it expires
// uncollected — the same tick clock as the fade above, for the same reason:
// every Player and Viewer has to see the same cell disappear on the same
// tick, which only a server-counted value (not a client-side wall-clock
// timer) can guarantee. ~10s, rounded to a whole number of ticks.
export const DEATH_FOOD_LIFETIME_TICKS = Math.round(10_000 / TICK_MS);

// How many of those ticks remain before a death-food cell counts as
// "expiring soon" for the client's blink warning — the final ~5s of its
// lifetime.
export const DEATH_FOOD_WARNING_TICKS = Math.round(5_000 / TICK_MS);

// A balancing cap on how many death-food cells can exist on the board at
// once, across every corpse's conversion combined — without one, a long
// session with nobody collecting death food would eventually leave no room
// to spawn ordinary food or new players. Oldest-first eviction (see
// capDeathFood in arena.ts) keeps whichever cells are closest to expiring
// anyway, so the cap rarely removes a cell before its own natural lifetime
// would have.
export const MAX_DEATH_FOOD_CELLS = 100;

// Room capacity, shared the same way: src/lib/room-server.ts enforces it
// server-side, and src/frontend/room-role-toggle.ts reads it client-side to
// render "Room is full (5/5)". It has to live here rather than in
// room-server.ts — that module imports src/lib/db.ts (better-sqlite3), which
// crashes if a browser bundle ever pulls it in, and room-role-toggle.ts is
// exactly such a bundle.
export const MAX_PLAYERS = 5;
