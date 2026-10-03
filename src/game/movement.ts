import type { Direction, Point } from "./types";

export function opposite(direction: Direction): Direction {
  switch (direction) {
    case "up":
      return "down";
    case "down":
      return "up";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

export function nextHeadPosition(head: Point, direction: Direction): Point {
  switch (direction) {
    case "up":
      return { x: head.x, y: head.y - 1 };
    case "down":
      return { x: head.x, y: head.y + 1 };
    case "left":
      return { x: head.x - 1, y: head.y };
    case "right":
      return { x: head.x + 1, y: head.y };
  }
}

// A snake can't reverse directly into its own neck — the real game-feel rule
// that stops a single stray keypress from being an instant, unavoidable
// self-collision. Any other change (including "no change") is allowed.
export function isValidDirectionChange(current: Direction, next: Direction): boolean {
  return next !== opposite(current);
}
