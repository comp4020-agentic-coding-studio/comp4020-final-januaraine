import { describe, expect, it } from "vitest";
import { randomEmptyCell } from "./food";

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
