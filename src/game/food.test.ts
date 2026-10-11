import { describe, expect, it } from "vitest";
import { eligibleDeathFoodCells, randomEmptyCell, tryRandomEmptyCell } from "./food";

// randomEmptyCell(gridSize, ...) scans a gridSize x gridSize board in
// row-major order (y outer, x inner) to build its free-cell list — every
// expected cell/index below follows that scan order.

describe("randomEmptyCell", () => {
  it("never places food on an occupied cell, whatever random() returns", () => {
    // 2x2 board (4 cells) with 3 occupied leaves exactly one free cell:
    // every random() value, however it rounds, must land on it.
    const occupied = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const food = randomEmptyCell(2, occupied, () => r);
      expect(food).toEqual({ x: 1, y: 1 });
    }
  });

  it("picks deterministically from the free cells for a given random source", () => {
    // 2x2 board, nothing occupied: free cells in scan order are
    // (0,0), (1,0), (0,1), (1,1).
    expect(randomEmptyCell(2, [], () => 0)).toEqual({ x: 0, y: 0 });
    expect(randomEmptyCell(2, [], () => 0.5)).toEqual({ x: 0, y: 1 });
  });

  it("throws rather than silently overlapping the snake when the board is full", () => {
    const everyCell = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(() => randomEmptyCell(2, everyCell, () => 0)).toThrow();
  });
});

describe("tryRandomEmptyCell", () => {
  it("picks the same way randomEmptyCell does when a cell is free", () => {
    const occupied = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(tryRandomEmptyCell(2, occupied, () => 0.5)).toEqual({ x: 1, y: 1 });
  });

  it("returns null instead of throwing when the board is full — a recoverable multiplayer state, not a bug", () => {
    const everyCell = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(tryRandomEmptyCell(2, everyCell, () => 0)).toBeNull();
  });
});

describe("eligibleDeathFoodCells", () => {
  it("returns every segment untouched when nothing is occupied", () => {
    const segments = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ];
    expect(eligibleDeathFoodCells(segments, [])).toEqual(segments);
  });

  it("excludes only the segments that overlap an occupied cell, preserving order", () => {
    const segments = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const occupied = [{ x: 1, y: 0 }]; // already food, another body, etc.
    expect(eligibleDeathFoodCells(segments, occupied)).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("returns an empty list, not an error, when every cell is blocked", () => {
    const segments = [{ x: 5, y: 5 }];
    expect(eligibleDeathFoodCells(segments, [{ x: 5, y: 5 }])).toEqual([]);
  });
});
