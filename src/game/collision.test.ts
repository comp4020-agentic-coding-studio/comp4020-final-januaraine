import { describe, expect, it } from "vitest";
import { hitsSelf, hitsWall } from "./collision";

describe("hitsWall", () => {
  const gridSize = 10;

  it("is false for every cell inside the grid", () => {
    expect(hitsWall({ x: 0, y: 0 }, gridSize)).toBe(false);
    expect(hitsWall({ x: 9, y: 9 }, gridSize)).toBe(false);
    expect(hitsWall({ x: 5, y: 5 }, gridSize)).toBe(false);
  });

  it("is true past every edge", () => {
    expect(hitsWall({ x: -1, y: 0 }, gridSize)).toBe(true);
    expect(hitsWall({ x: 0, y: -1 }, gridSize)).toBe(true);
    expect(hitsWall({ x: 10, y: 0 }, gridSize)).toBe(true);
    expect(hitsWall({ x: 0, y: 10 }, gridSize)).toBe(true);
  });
});

describe("hitsSelf", () => {
  const body = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ];

  it("is true when the head overlaps a body segment", () => {
    expect(hitsSelf({ x: 4, y: 5 }, body)).toBe(true);
  });

  it("is false when the head lands on an empty cell", () => {
    expect(hitsSelf({ x: 6, y: 5 }, body)).toBe(false);
  });
});
