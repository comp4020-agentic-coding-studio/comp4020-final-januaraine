import { POINTS_PER_FOOD } from "./config";
import { hitsSelf, hitsWall } from "./collision";
import { randomEmptyCell } from "./food";
import { isValidDirectionChange, nextHeadPosition } from "./movement";
import type { Direction, GameState, RandomSource } from "./types";

// Queues a direction change for the next tick — never mutates `direction`
// directly, so a key pressed twice between ticks doesn't let the snake
// reverse through itself one frame at a time.
export function setDirection(state: GameState, direction: Direction): GameState {
  if (state.status !== "playing") return state;
  return { ...state, pendingDirection: direction };
}

// The one authoritative step: given a state and (for food placement) a
// random source, produces the next state. Deterministic in every other
// respect, which is exactly the property C9's server-authoritative loop
// needs — the same function can run once per tick on the server instead of
// in the browser, with no change to its logic.
export function tick(state: GameState, random: RandomSource = Math.random): GameState {
  if (state.status !== "playing") return state;

  const direction = isValidDirectionChange(state.direction, state.pendingDirection)
    ? state.pendingDirection
    : state.direction;

  const head = nextHeadPosition(state.snake[0], direction);
  const ateFood = head.x === state.food.x && head.y === state.food.y;

  // The tail cell empties this same tick unless the snake is growing, so a
  // move into the *vacated* tail is legal — checking against the
  // about-to-be-dropped tail would reject a completely ordinary move.
  const bodyToCheck = ateFood ? state.snake : state.snake.slice(0, -1);

  if (hitsWall(head, state.gridSize) || hitsSelf(head, bodyToCheck)) {
    return { ...state, direction, status: "over" };
  }

  const snake = ateFood ? [head, ...state.snake] : [head, ...state.snake.slice(0, -1)];
  const score = ateFood ? state.score + POINTS_PER_FOOD : state.score;
  const food = ateFood ? randomEmptyCell(state.gridSize, snake, random) : state.food;

  return {
    ...state,
    snake,
    direction,
    pendingDirection: direction,
    food,
    score,
    ticks: state.ticks + 1,
  };
}
