import type { Point, RandomSource } from "./types";

// Picks uniformly among every cell the snake doesn't occupy, rather than
// retrying random (x, y) guesses until one misses — deterministic in the
// number of random() calls (always exactly one), which is what makes this
// testable with a scripted RandomSource instead of a retry-count-dependent
// mock. Returns null instead of throwing when nothing is free: a full board
// is a real, recoverable state in a multiplayer arena (several snakes plus
// death food can fill it up temporarily), not a bug, so the caller gets to
// decide whether "no cell available right now" is fatal.
export function tryRandomEmptyCell(gridSize: number, occupied: readonly Point[], random: RandomSource): Point | null {
  const occupiedKeys = new Set(occupied.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (!occupiedKeys.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  const index = Math.floor(random() * free.length);
  return free[Math.min(index, free.length - 1)];
}

// The throwing variant callers use where there genuinely is no way to
// proceed without a cell — placing the very first food, or spawning a brand
// new player.
export function randomEmptyCell(gridSize: number, occupied: readonly Point[], random: RandomSource): Point {
  const cell = tryRandomEmptyCell(gridSize, occupied, random);
  if (!cell) {
    throw new Error("no empty cell left to place food — the snake fills the whole board");
  }
  return cell;
}

// Which of an eliminated snake's body cells are free to become food once its
// death fade completes — never a cell already holding food, another snake's
// live body, or a cell some other still-fading corpse is also sitting on.
// Pure and order-preserving (same order as the snake's own segments), so
// conversion is deterministic and callers can keep extending `occupied` as
// they place each snake's cells in turn, to dedup across snakes expiring on
// the same tick.
export function eligibleDeathFoodCells(segments: readonly Point[], occupied: readonly Point[]): Point[] {
  const occupiedKeys = new Set(occupied.map((p) => `${p.x},${p.y}`));
  return segments.filter((seg) => !occupiedKeys.has(`${seg.x},${seg.y}`));
}
