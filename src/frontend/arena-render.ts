import type { SerializedArena } from "../game/arena";

// A new render function, not a change to render.ts: single-player's
// renderer stays exactly as it was (one snake, no "mine" concept), and this
// one draws a SerializedArena (many snakes, each already flagged `isMine`
// by the server — never computed here from anything client-side).
export function renderArena(ctx: CanvasRenderingContext2D, state: SerializedArena, cellPx: number): void {
  const sizePx = state.gridSize * cellPx;

  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(0, 0, sizePx, sizePx);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
  ctx.lineWidth = 1;
  for (let i = 1; i < state.gridSize; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellPx, 0);
    ctx.lineTo(i * cellPx, sizePx);
    ctx.moveTo(0, i * cellPx);
    ctx.lineTo(sizePx, i * cellPx);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffb454";
  const foodPad = cellPx * 0.18;
  ctx.beginPath();
  ctx.arc(state.food.x * cellPx + cellPx / 2, state.food.y * cellPx + cellPx / 2, cellPx / 2 - foodPad, 0, Math.PI * 2);
  ctx.fill();

  let otherIndex = 0;
  for (const snake of state.snakes) {
    const [headColor, bodyColor] = snake.isMine ? (["#39ff8f", "#1fae5f"] as const) : colorFor(otherIndex++);
    snake.segments.forEach((segment, index) => {
      ctx.fillStyle = index === 0 ? headColor : bodyColor;
      const pad = cellPx * 0.08;
      ctx.fillRect(segment.x * cellPx + pad, segment.y * cellPx + pad, cellPx - pad * 2, cellPx - pad * 2);
    });
  }
}

// Spread by a fixed angle rather than picked from a short fixed palette, so
// colors stay visually distinct from each other (not from "mine") no matter
// how many other players happen to be in the arena at once. Exported so the
// page's own players-list swatches match the canvas exactly, rather than
// keeping a second copy of the same formula.
export function colorFor(index: number): readonly [string, string] {
  const hue = (index * 67) % 360;
  return [`hsl(${hue}, 85%, 60%)`, `hsl(${hue}, 55%, 38%)`];
}
