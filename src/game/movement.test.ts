import { describe, expect, it } from "vitest";
import { isValidDirectionChange, nextHeadPosition, opposite } from "./movement";

describe("nextHeadPosition", () => {
  it("steps one cell in each direction", () => {
    const head = { x: 5, y: 5 };
    expect(nextHeadPosition(head, "up")).toEqual({ x: 5, y: 4 });
    expect(nextHeadPosition(head, "down")).toEqual({ x: 5, y: 6 });
    expect(nextHeadPosition(head, "left")).toEqual({ x: 4, y: 5 });
    expect(nextHeadPosition(head, "right")).toEqual({ x: 6, y: 5 });
  });
});

describe("isValidDirectionChange", () => {
  it("allows continuing straight or turning 90 degrees", () => {
    expect(isValidDirectionChange("right", "right")).toBe(true);
    expect(isValidDirectionChange("right", "up")).toBe(true);
    expect(isValidDirectionChange("right", "down")).toBe(true);
  });

  it("rejects reversing directly into the snake's own neck", () => {
    expect(isValidDirectionChange("right", "left")).toBe(false);
    expect(isValidDirectionChange("up", "down")).toBe(false);
  });

  it("is the inverse of opposite()", () => {
    for (const dir of ["up", "down", "left", "right"] as const) {
      expect(isValidDirectionChange(dir, opposite(dir))).toBe(false);
    }
  });
});
