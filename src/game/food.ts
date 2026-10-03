import type { Point, RandomSource } from "./types";

// Picks uniformly among every cell the snake doesn't occupy, rather than
// retrying random (x, y) guesses until one misses — deterministic in the
// number of random() calls (always exactly one), which is what makes this
// testable with a scripted RandomSource instead of a retry-count-dependent
// mock.
export function randomEmptyCell(gridSize: number, occupied: readonly Point[], random: RandomSource): Point {
  const occupiedKeys = new Set(occupied.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (!occupiedKeys.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) {
    throw new Error("no empty cell left to place food — the snake fills the whole board");
  }
  const index = Math.floor(random() * free.length);
  return free[Math.min(index, free.length - 1)];
}
