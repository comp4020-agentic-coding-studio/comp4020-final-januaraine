import type { GameState } from "../game/types";

// Snake Arena's own look: a dark arena, a phosphor-green snake, an amber
// food dot — no assets, no sprites, just shapes on a canvas. Takes the
// state and draws it; owns no state of its own, so it has nothing to get out
// of sync with the game logic that produced what it's drawing.
export function render(ctx: CanvasRenderingContext2D, state: GameState, cellPx: number): void {
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
  ctx.arc(
    state.food.x * cellPx + cellPx / 2,
    state.food.y * cellPx + cellPx / 2,
    cellPx / 2 - foodPad,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  state.snake.forEach((segment, index) => {
    const isHead = index === 0;
    ctx.fillStyle = isHead ? "#39ff8f" : "#1fae5f";
    const pad = cellPx * 0.08;
    ctx.fillRect(segment.x * cellPx + pad, segment.y * cellPx + pad, cellPx - pad * 2, cellPx - pad * 2);
  });
}
