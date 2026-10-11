// The multiplayer counterpart to state.ts/rules.ts: still pure, framework-
// independent, no I/O (see CLAUDE.md's architecture boundary) — only the
// shape of the state changes, from one snake to a record of them sharing one
// board. src/lib/arena-server.ts is the only thing that calls this from
// outside a test, on a server-side interval, the same way single-player's
// loop.ts calls rules.ts's tick() from a client-side interval.
import { POINTS_PER_FOOD, GRID_SIZE } from "./config";
import { hitsSelf, hitsWall } from "./collision";
import { randomEmptyCell } from "./food";
import { isValidDirectionChange, nextHeadPosition } from "./movement";
import type { Direction, Point, RandomSource } from "./types";

export interface ArenaSnake {
  readonly playerId: number;
  readonly displayName: string;
  readonly segments: readonly Point[]; // head first
  readonly direction: Direction;
  readonly pendingDirection: Direction;
  readonly score: number;
  readonly ticks: number; // ticks survived since this snake joined/respawned
}

export interface ArenaState {
  readonly snakes: { readonly [playerId: number]: ArenaSnake };
  readonly food: Point;
  readonly gridSize: number;
}

export type EliminationReason = "wall" | "self" | "snake";

export interface EliminatedPlayer {
  readonly playerId: number;
  readonly score: number;
  readonly ticks: number;
  readonly reason: EliminationReason;
}

export interface ArenaTickResult {
  readonly state: ArenaState;
  readonly eliminated: readonly EliminatedPlayer[];
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

export interface SerializedArena {
  readonly gridSize: number;
  readonly food: Point;
  readonly snakes: readonly SerializedArenaSnake[];
}

function allSegments(state: ArenaState): Point[] {
  return Object.values(state.snakes).flatMap((snake) => snake.segments);
}

export function createArena(gridSize: number = GRID_SIZE, random: RandomSource = Math.random): ArenaState {
  return { snakes: {}, food: randomEmptyCell(gridSize, [], random), gridSize };
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

  const occupied = [...allSegments(state), state.food];
  const spawn = randomEmptyCell(state.gridSize, occupied, random);
  const direction = safeSpawnDirection(spawn, state.gridSize);
  const snake: ArenaSnake = {
    playerId,
    displayName,
    segments: [spawn],
    direction,
    pendingDirection: direction,
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
export function setArenaDirection(state: ArenaState, playerId: number, direction: Direction): ArenaState {
  const snake = state.snakes[playerId];
  if (!snake) return state;
  return { ...state, snakes: { ...state.snakes, [playerId]: { ...snake, pendingDirection: direction } } };
}

// The one authoritative step, run once per server tick for every snake at
// once. Collisions are evaluated against a single consistent snapshot of
// the *pre-move* board (each snake's own about-to-be-vacated tail cell
// already excluded, exactly like rules.ts's tick()) so the outcome doesn't
// depend on which order snakes happen to be iterated in.
export function tickArena(state: ArenaState, random: RandomSource = Math.random): ArenaTickResult {
  const entries = Object.values(state.snakes);
  if (entries.length === 0) return { state, eliminated: [] };

  const resolvedDirection = new Map<number, Direction>();
  const newHead = new Map<number, Point>();
  const ateFood = new Map<number, boolean>();
  const bodyToCheck = new Map<number, readonly Point[]>();

  for (const snake of entries) {
    const direction = isValidDirectionChange(snake.direction, snake.pendingDirection)
      ? snake.pendingDirection
      : snake.direction;
    resolvedDirection.set(snake.playerId, direction);

    const head = nextHeadPosition(snake.segments[0], direction);
    newHead.set(snake.playerId, head);

    const ate = head.x === state.food.x && head.y === state.food.y;
    ateFood.set(snake.playerId, ate);
    bodyToCheck.set(snake.playerId, ate ? snake.segments : snake.segments.slice(0, -1));
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
  // since nobody lived to eat it.
  const survivorAteFood = entries.some((s) => !eliminatedReason.has(s.playerId) && ateFood.get(s.playerId));
  const newFood = survivorAteFood
    ? randomEmptyCell(
        state.gridSize,
        entries.flatMap((s) =>
          eliminatedReason.has(s.playerId) ? s.segments : [newHead.get(s.playerId)!, ...s.segments],
        ),
        random,
      )
    : state.food;

  const snakes: Record<number, ArenaSnake> = {};
  const eliminated: EliminatedPlayer[] = [];

  for (const snake of entries) {
    const reason = eliminatedReason.get(snake.playerId);
    if (reason) {
      eliminated.push({ playerId: snake.playerId, score: snake.score, ticks: snake.ticks, reason });
      continue;
    }
    const head = newHead.get(snake.playerId)!;
    const direction = resolvedDirection.get(snake.playerId)!;
    const grew = survivorAteFood && ateFood.get(snake.playerId)!;
    const segments = grew ? [head, ...snake.segments] : [head, ...snake.segments.slice(0, -1)];
    snakes[snake.playerId] = {
      ...snake,
      segments,
      direction,
      pendingDirection: direction,
      score: grew ? snake.score + POINTS_PER_FOOD : snake.score,
      ticks: snake.ticks + 1,
    };
  }

  return { state: { snakes, food: newFood, gridSize: state.gridSize }, eliminated };
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
  };
}
