import type { Point } from "./types";

export function hitsWall(point: Point, gridSize: number): boolean {
  return point.x < 0 || point.y < 0 || point.x >= gridSize || point.y >= gridSize;
}

// Checked against the body the snake will still occupy after this move, head
// included — call this with the *new* head and the *current* snake (before
// the tail is dropped), matching how rules.ts actually builds the next
// state.
export function hitsSelf(head: Point, body: readonly Point[]): boolean {
  return body.some((segment) => segment.x === head.x && segment.y === head.y);
}
