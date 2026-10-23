// The multiplayer counterpart to state.ts/rules.ts: still pure, framework-
// independent, no I/O (see CLAUDE.md's architecture boundary) — only the
// shape of the state changes, from one snake to a record of them sharing one
// board. src/lib/arena-server.ts is the only thing that calls this from
// outside a test, on a server-side interval, the same way single-player's
// loop.ts calls rules.ts's tick() from a client-side interval.
import { POINTS_PER_FOOD, GRID_SIZE, DEATH_FADE_TICKS } from "./config";
import { hitsSelf, hitsWall } from "./collision";
import { eligibleDeathFoodCells, randomEmptyCell, tryRandomEmptyCell } from "./food";
import { isValidDirectionChange, nextHeadPosition } from "./movement";
import type { Direction, Point, RandomSource } from "./types";

export interface ArenaSnake {
  readonly playerId: number;
  readonly displayName: string;
  readonly segments: readonly Point[]; // head first
  readonly direction: Direction;
  readonly pendingDirection: Direction;
  // A second queued turn, held for the tick *after* pendingDirection applies
  // — see setArenaDirection. One slot is enough: a player can only react to
  // what's on screen, and what's on screen only changes once per tick, so
  // there's never a legitimate third turn to hold onto before the first two
  // have had a chance to apply.
  readonly queuedDirection: Direction | null;
  readonly score: number;
  readonly ticks: number; // ticks survived since this snake joined/respawned
}

// "spawn" is the one always-present ambient food the classic game has always
// had — eaten, it's replaced via the existing random-spawn logic. "death" is
// a one-shot cell left behind by an eliminated snake's body: eaten, it's
// just gone, no replacement. Both grow/score a snake identically; the tag
// only ever matters for the replace-or-don't decision in tickArena.
export type FoodSource = "spawn" | "death";

export interface FoodItem extends Point {
  readonly source: FoodSource;
}

export type EliminationReason = "wall" | "self" | "snake";

// An eliminated snake's frozen remains, visible to every client as a fading
// body for DEATH_FADE_TICKS ticks before converting to food. `segments` is
// the snake's last valid (on-grid) body — the pre-move body, not the fatal
// head, so this stays a well-formed set of board cells for all three
// elimination reasons (a wall death's "head" would otherwise be off-grid).
export interface DyingSnake {
  readonly playerId: number;
  readonly displayName: string;
  readonly segments: readonly Point[];
  readonly reason: EliminationReason;
  readonly ticksRemaining: number;
}

export interface ArenaState {
  readonly snakes: { readonly [playerId: number]: ArenaSnake };
  readonly dying: readonly DyingSnake[];
  readonly food: readonly FoodItem[];
  readonly gridSize: number;
}

export interface EliminatedPlayer {
  readonly playerId: number;
  readonly score: number;
  readonly ticks: number;
  readonly reason: EliminationReason;
}

// Which player ate which food item this tick, purely for C10's
// player-attributed `food_collected` logging — the arena's own state
// transition above never needs "who," only "which index."
export interface EatenFood {
  readonly playerId: number;
  readonly source: FoodSource;
}

export interface ArenaTickResult {
  readonly state: ArenaState;
  readonly eliminated: readonly EliminatedPlayer[];
  readonly eaten: readonly EatenFood[];
}

// The wire shape clients actually receive: no raw playerId, the same
// "isMine, computed server-side from the session" pattern
// lib/db.ts's LeaderboardEntry already uses, rather than ever handing a
// client an internal database id to compare against.
export interface SerializedArenaSnake {
  readonly displayName: string;
  readonly segments: readonly Point[];
  readonly score: number;
  readonly isMine: boolean;
}

// A dying snake's own wire shape — same "isMine" pattern as a live snake,
// plus `opacity` (1 at the moment of death, fading to 0), computed
// server-side from `ticksRemaining` so no client ever decides for itself how
// far along the fade is.
export interface SerializedDyingSnake {
  readonly displayName: string;
  readonly segments: readonly Point[];
  readonly reason: EliminationReason;
  readonly isMine: boolean;
  readonly opacity: number;
}

export interface SerializedArena {
  readonly gridSize: number;
  readonly food: readonly FoodItem[];
  readonly snakes: readonly SerializedArenaSnake[];
  readonly dying: readonly SerializedDyingSnake[];
}

// Everything a spawn point (a new player, or a fresh food cell) must avoid:
// every live snake's body, plus every still-fading corpse's — a brand-new
// player or food item should never land on top of a death animation still
// playing out.
function allSegments(state: ArenaState): Point[] {
  return [
    ...Object.values(state.snakes).flatMap((snake) => snake.segments),
    ...state.dying.flatMap((d) => d.segments),
  ];
}

export function createArena(gridSize: number = GRID_SIZE, random: RandomSource = Math.random): ArenaState {
  const spawn = randomEmptyCell(gridSize, [], random);
  return { snakes: {}, dying: [], food: [{ ...spawn, source: "spawn" }], gridSize };
}

// A fresh snake starts facing whichever of the four walls it's farthest
// from, rather than always "right" — a spawn cell is uniform-random over
// the whole board, so always facing right could put a brand-new player a
// single tick from an unavoidable wall death before they've even seen the
// board, let alone reacted. Ties (most relevant on an empty board, where
// spawn lands at a scan-order corner) keep "right" as the preferred
// direction, matching this function's previous fixed default.
function safeSpawnDirection(spawn: Point, gridSize: number): Direction {
  const clearances: readonly { direction: Direction; clearance: number }[] = [
    { direction: "right", clearance: gridSize - 1 - spawn.x },
    { direction: "left", clearance: spawn.x },
    { direction: "down", clearance: gridSize - 1 - spawn.y },
    { direction: "up", clearance: spawn.y },
  ];
  return clearances.reduce((best, c) => (c.clearance > best.clearance ? c : best)).direction;
}

// Adding a player who already has a live snake is a no-op — this is what
// makes a reconnect (a second /api/arena/stream open before the first one's
// grace timer fires) safe to call through the same join path rather than
// needing its own "is this a rejoin" branch in the caller.
export function joinArena(
  state: ArenaState,
  playerId: number,
  displayName: string,
  random: RandomSource = Math.random,
): ArenaState {
  if (state.snakes[playerId]) return state;

  const occupied = [...allSegments(state), ...state.food];
  const spawn = randomEmptyCell(state.gridSize, occupied, random);
  const direction = safeSpawnDirection(spawn, state.gridSize);
  const snake: ArenaSnake = {
    playerId,
    displayName,
    segments: [spawn],
    direction,
    pendingDirection: direction,
    queuedDirection: null,
    score: 0,
    ticks: 0,
  };
  return { ...state, snakes: { ...state.snakes, [playerId]: snake } };
}

export function leaveArena(state: ArenaState, playerId: number): ArenaState {
  if (!state.snakes[playerId]) return state;
  const snakes = { ...state.snakes };
  delete snakes[playerId];
  return { ...state, snakes };
}

// Same queue-don't-mutate rule as rules.ts's setDirection, just keyed by
// which player's snake it applies to — one player's input can never affect
// another's pendingDirection.
//
// pendingDirection === direction means no turn is currently queued for the
// next tick, so a fresh input takes that slot immediately — the original,
// unchanged behaviour for an ordinary single keypress between ticks. If a
// turn is already queued (pendingDirection !== direction), a second input
// before the next tick would otherwise just overwrite the first and the
// player's first turn would silently vanish — exactly the input loss this
// one-deep queuedDirection slot exists to prevent. A third input before
// either applies still only has one slot to land in, so it replaces
// queuedDirection the same way the pre-queue code always replaced
// pendingDirection — last-write-wins never applies to more than the single
// most-recent not-yet-applied turn.
export function setArenaDirection(state: ArenaState, playerId: number, direction: Direction): ArenaState {
  const snake = state.snakes[playerId];
  if (!snake) return state;

  if (snake.pendingDirection === snake.direction) {
    return { ...state, snakes: { ...state.snakes, [playerId]: { ...snake, pendingDirection: direction } } };
  }
  return { ...state, snakes: { ...state.snakes, [playerId]: { ...snake, queuedDirection: direction } } };
}

// The one authoritative step, run once per server tick for every snake at
// once. Collisions are evaluated against a single consistent snapshot of
// the *pre-move* board (each snake's own about-to-be-vacated tail cell
// already excluded, exactly like rules.ts's tick()) so the outcome doesn't
// depend on which order snakes happen to be iterated in. A snake eliminated
// this tick is immediately dropped from `snakes` — the live collision/
// movement set — so it can never move or collide again, even mid-fade; its
// frozen body goes into `dying` instead, purely for every client's fade
// animation and for the eventual food conversion below.
export function tickArena(state: ArenaState, random: RandomSource = Math.random): ArenaTickResult {
  const entries = Object.values(state.snakes);
  if (entries.length === 0 && state.dying.length === 0) {
    return { state, eliminated: [], eaten: [] };
  }

  const resolvedDirection = new Map<number, Direction>();
  const newHead = new Map<number, Point>();
  const ateIndex = new Map<number, number>(); // index into state.food, -1 if none
  const bodyToCheck = new Map<number, readonly Point[]>();

  for (const snake of entries) {
    const direction = isValidDirectionChange(snake.direction, snake.pendingDirection)
      ? snake.pendingDirection
      : snake.direction;
    resolvedDirection.set(snake.playerId, direction);

    const head = nextHeadPosition(snake.segments[0], direction);
    newHead.set(snake.playerId, head);

    const idx = state.food.findIndex((f) => f.x === head.x && f.y === head.y);
    ateIndex.set(snake.playerId, idx);
    bodyToCheck.set(snake.playerId, idx !== -1 ? snake.segments : snake.segments.slice(0, -1));
  }

  const eliminatedReason = new Map<number, EliminationReason>();
  for (const snake of entries) {
    const head = newHead.get(snake.playerId)!;

    if (hitsWall(head, state.gridSize)) {
      eliminatedReason.set(snake.playerId, "wall");
      continue;
    }
    if (hitsSelf(head, bodyToCheck.get(snake.playerId)!)) {
      eliminatedReason.set(snake.playerId, "self");
      continue;
    }
    for (const other of entries) {
      if (other.playerId === snake.playerId) continue;
      const otherHead = newHead.get(other.playerId)!;
      if (head.x === otherHead.x && head.y === otherHead.y) {
        // Head-to-head: both eliminated, not just the one iterated first.
        eliminatedReason.set(snake.playerId, "snake");
        break;
      }
      if (bodyToCheck.get(other.playerId)!.some((seg) => seg.x === head.x && seg.y === head.y)) {
        eliminatedReason.set(snake.playerId, "snake");
        break;
      }
    }
  }

  // Food is only actually consumed if a *surviving* snake reached it — a
  // mutual head-to-head collision on the food cell leaves it in place,
  // since nobody lived to eat it. Removed highest-index-first so earlier
  // indices stay valid mid-removal. Eating either source grows/scores the
  // same; only a consumed "spawn" item ever gets replaced (death food is
  // one-shot, see the FoodSource comment above). `eaten` is purely
  // observational (who ate what, for C10's logging) and has no bearing on
  // the arena's own state transition below.
  let food: FoodItem[] = [...state.food];
  const consumedEntries = entries.filter(
    (s) => !eliminatedReason.has(s.playerId) && ateIndex.get(s.playerId)! !== -1,
  );
  const eaten: EatenFood[] = consumedEntries.map((s) => ({
    playerId: s.playerId,
    source: state.food[ateIndex.get(s.playerId)!].source,
  }));
  const consumedDesc = consumedEntries.map((s) => ateIndex.get(s.playerId)!).sort((a, b) => b - a);
  let spawnReplacementsNeeded = 0;
  for (const idx of consumedDesc) {
    if (food[idx].source === "spawn") spawnReplacementsNeeded++;
    food.splice(idx, 1);
  }

  // Surviving snakes' next bodies — needed for the final state and for what
  // a death-food conversion below must avoid landing on.
  const nextSegments = new Map<number, readonly Point[]>();
  for (const snake of entries) {
    if (eliminatedReason.has(snake.playerId)) continue;
    const head = newHead.get(snake.playerId)!;
    const grew = ateIndex.get(snake.playerId)! !== -1;
    nextSegments.set(snake.playerId, grew ? [head, ...snake.segments] : [head, ...snake.segments.slice(0, -1)]);
  }

  // Advance every still-fading corpse; ones that just expired convert to
  // food. `blocked` tracks every cell a new death-food cell must avoid —
  // existing food, every surviving snake's new body, and every other corpse
  // (fading or just-converted) — grown as each expiring snake's own cells
  // are claimed, so two corpses expiring on the same tick (processed in a
  // fixed playerId order for determinism) can never drop food on the same
  // cell. A snake with no eligible cells at all just contributes none.
  const decremented = state.dying.map((d) => ({ ...d, ticksRemaining: d.ticksRemaining - 1 }));
  const stillDying = decremented.filter((d) => d.ticksRemaining > 0);
  const expiring = decremented.filter((d) => d.ticksRemaining <= 0).sort((a, b) => a.playerId - b.playerId);

  const blocked: Point[] = [...food, ...[...nextSegments.values()].flat(), ...stillDying.flatMap((d) => d.segments)];
  for (const dead of expiring) {
    for (const cell of eligibleDeathFoodCells(dead.segments, blocked)) {
      food.push({ ...cell, source: "death" });
      blocked.push(cell);
    }
  }

  // Snakes eliminated this tick join the fade with a frozen, on-grid body
  // (their pre-move segments — a wall death's fatal "head" would otherwise
  // be off-grid, and every reason should produce a well-formed corpse).
  const newlyDying: DyingSnake[] = entries
    .filter((s) => eliminatedReason.has(s.playerId))
    .map((s) => ({
      playerId: s.playerId,
      displayName: s.displayName,
      segments: s.segments,
      reason: eliminatedReason.get(s.playerId)!,
      ticksRemaining: DEATH_FADE_TICKS,
    }));

  // Replace each consumed "spawn" item via the existing random-spawn logic,
  // avoiding every cell now occupied (including the death food and corpses
  // just added above). If the board is momentarily full, skip for this tick
  // rather than crashing the room — it'll retry on the next one.
  const occupiedForSpawn: Point[] = [...blocked, ...newlyDying.flatMap((d) => d.segments)];
  for (let i = 0; i < spawnReplacementsNeeded; i++) {
    const replacement = tryRandomEmptyCell(state.gridSize, occupiedForSpawn, random);
    if (!replacement) break;
    food.push({ ...replacement, source: "spawn" });
    occupiedForSpawn.push(replacement);
  }

  const snakes: Record<number, ArenaSnake> = {};
  const eliminated: EliminatedPlayer[] = [];

  for (const snake of entries) {
    const reason = eliminatedReason.get(snake.playerId);
    if (reason) {
      eliminated.push({ playerId: snake.playerId, score: snake.score, ticks: snake.ticks, reason });
      continue;
    }
    const direction = resolvedDirection.get(snake.playerId)!;
    const grew = ateIndex.get(snake.playerId)! !== -1;
    // The turn just applied frees up the pending slot — promote whatever
    // was queued behind it (if anything) into that slot so it's ready to
    // apply next tick, re-validated then against this tick's new `direction`
    // exactly like any other pendingDirection. No queued turn just means
    // "nothing changes," same as before this queue existed.
    snakes[snake.playerId] = {
      ...snake,
      segments: nextSegments.get(snake.playerId)!,
      direction,
      pendingDirection: snake.queuedDirection ?? direction,
      queuedDirection: null,
      score: grew ? snake.score + POINTS_PER_FOOD : snake.score,
      ticks: snake.ticks + 1,
    };
  }

  return {
    state: { snakes, dying: [...stillDying, ...newlyDying], food, gridSize: state.gridSize },
    eliminated,
    eaten,
  };
}

export function serializeArena(state: ArenaState, viewerPlayerId?: number): SerializedArena {
  return {
    gridSize: state.gridSize,
    food: state.food,
    snakes: Object.values(state.snakes).map((snake) => ({
      displayName: snake.displayName,
      segments: snake.segments,
      score: snake.score,
      isMine: snake.playerId === viewerPlayerId,
    })),
    dying: state.dying.map((d) => ({
      displayName: d.displayName,
      segments: d.segments,
      reason: d.reason,
      isMine: d.playerId === viewerPlayerId,
      opacity: d.ticksRemaining / DEATH_FADE_TICKS,
    })),
  };
}
