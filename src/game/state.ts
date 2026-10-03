import { GRID_SIZE } from "./config";
import { randomEmptyCell } from "./food";
import type { GameState, RandomSource } from "./types";

// A fresh board: one-segment snake centred on the grid, facing right, food
// placed somewhere else on the board. "ready" (not "playing") so the caller
// decides when input starts moving the snake — the landing frame of a new
// game and the frame right after a restart should look identical.
export function createInitialState(gridSize: number = GRID_SIZE, random: RandomSource = Math.random): GameState {
  const center = Math.floor(gridSize / 2);
  const snake = [{ x: center, y: center }];
  const food = randomEmptyCell(gridSize, snake, random);
  return {
    snake,
    direction: "right",
    pendingDirection: "right",
    food,
    score: 0,
    status: "ready",
    gridSize,
    ticks: 0,
  };
}

export function startGame(state: GameState): GameState {
  if (state.status !== "ready") return state;
  return { ...state, status: "playing" };
}
