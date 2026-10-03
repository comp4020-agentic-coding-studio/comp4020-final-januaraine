// The whole game-core contract: no DOM, no framework, no I/O. C9's
// authoritative server loop is meant to import these same types and
// functions unchanged — only who calls tick() and where the result goes
// changes.

export type Direction = "up" | "down" | "left" | "right";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type GameStatus = "ready" | "playing" | "over";

export interface GameState {
  readonly snake: readonly Point[]; // head first
  readonly direction: Direction;
  // Queued input, applied on the next tick rather than immediately — a key
  // pressed between ticks can't make the snake reverse into itself mid-step.
  readonly pendingDirection: Direction;
  readonly food: Point;
  readonly score: number;
  readonly status: GameStatus;
  readonly gridSize: number;
  // Ticks elapsed since "playing" started — the authoritative survival-time
  // unit (see config.ts's TICK_MS comment).
  readonly ticks: number;
}

// Pure functions here take this instead of calling Math.random() directly,
// so a test can supply a scripted sequence and assert on an exact outcome.
export type RandomSource = () => number;
