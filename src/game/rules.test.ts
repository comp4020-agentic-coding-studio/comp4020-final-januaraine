import { describe, expect, it } from "vitest";
import { POINTS_PER_FOOD } from "./config";
import { setDirection, tick } from "./rules";
import { createInitialState, startGame } from "./state";
import type { GameState } from "./types";

// A fixed random source keeps every test's food placement predictable.
const fixedRandom = () => 0;

function playing(gridSize = 10): GameState {
  return startGame(createInitialState(gridSize, fixedRandom));
}

// A 4-cell square loop: head at (5,5), then (6,5), (6,6), tail at (5,6) —
// the tail is directly below the head. The minimum cycle length on a square
// grid is 4, which is what makes "step onto your own vacating tail" only
// possible with at least this many segments.
const LOOP_SNAKE = [
  { x: 5, y: 5 },
  { x: 6, y: 5 },
  { x: 6, y: 6 },
  { x: 5, y: 6 },
];

describe("tick", () => {
  it("moves the snake one cell per tick without growing it", () => {
    const state = playing();
    const before = state.snake.length;
    const next = tick(state, fixedRandom);
    expect(next.snake).toHaveLength(before);
    expect(next.snake[0]).toEqual({ x: state.snake[0].x + 1, y: state.snake[0].y }); // facing "right"
    expect(next.ticks).toBe(state.ticks + 1);
  });

  it("is a no-op on a game that hasn't started or has already ended", () => {
    const ready = createInitialState(10, fixedRandom);
    expect(tick(ready, fixedRandom)).toBe(ready);

    const over: GameState = { ...playing(), status: "over" };
    expect(tick(over, fixedRandom)).toBe(over);
  });

  it("grows the snake and increases score on eating food", () => {
    // Put food directly in front of the head so the very next tick eats it.
    const base = playing(10);
    const state: GameState = { ...base, food: { x: base.snake[0].x + 1, y: base.snake[0].y } };
    const before = state.snake.length;

    const next = tick(state, fixedRandom);

    expect(next.snake).toHaveLength(before + 1);
    expect(next.score).toBe(state.score + POINTS_PER_FOOD);
    expect(next.status).toBe("playing");
  });

  it("moves food to a new cell once eaten", () => {
    const base = playing(10);
    const eatenAt = { x: base.snake[0].x + 1, y: base.snake[0].y };
    const state: GameState = { ...base, food: eatenAt };

    const next = tick(state, () => 0.9);

    expect(next.food).not.toEqual(eatenAt);
  });

  it("ends the game on wall collision", () => {
    // Snake at the right edge, facing right: the next tick runs off the board.
    const state: GameState = {
      ...playing(10),
      snake: [{ x: 9, y: 5 }],
      direction: "right",
      pendingDirection: "right",
      food: { x: 0, y: 0 },
    };

    const next = tick(state, fixedRandom);
    expect(next.status).toBe("over");
  });

  it("ends the game on self collision", () => {
    // Moving right drives the head onto (6,5) — the snake's own second
    // segment, which is NOT the tail, so nothing vacates it this tick.
    const state: GameState = {
      ...playing(10),
      snake: LOOP_SNAKE,
      direction: "right",
      pendingDirection: "right",
      food: { x: 0, y: 0 },
    };

    const next = tick(state, fixedRandom);
    expect(next.status).toBe("over");
  });

  it("allows moving into the cell the tail is about to vacate", () => {
    // Moving down drives the head onto (5,6) — the snake's own tail, which
    // empties this same tick because the snake isn't growing. That's an
    // ordinary loop move, not a collision.
    const state: GameState = {
      ...playing(10),
      snake: LOOP_SNAKE,
      direction: "down",
      pendingDirection: "down",
      food: { x: 0, y: 0 },
    };

    const next = tick(state, fixedRandom);
    expect(next.status).toBe("playing");
    expect(next.snake[0]).toEqual({ x: 5, y: 6 });
  });

  it("ignores a queued 180-degree reversal instead of ending the game", () => {
    const state: GameState = {
      ...playing(10),
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
      ],
      direction: "right",
      food: { x: 0, y: 0 },
    };
    const reversed = setDirection(state, "left");
    const next = tick(reversed, fixedRandom);
    // Still moved right (continued the old direction), not into its own neck.
    expect(next.status).toBe("playing");
    expect(next.snake[0]).toEqual({ x: 6, y: 5 });
  });
});

describe("setDirection", () => {
  it("queues a direction without moving the snake", () => {
    const state = playing();
    const next = setDirection(state, "up");
    expect(next.snake).toEqual(state.snake);
    expect(next.pendingDirection).toBe("up");
    expect(next.direction).toBe(state.direction);
  });

  it("does nothing before the game has started", () => {
    const ready = createInitialState(10, fixedRandom);
    expect(setDirection(ready, "up")).toBe(ready);
  });
});
