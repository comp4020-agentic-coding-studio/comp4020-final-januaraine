import { isFoodExpiring, type SerializedArena } from "../game/arena";

// The colors a frame is drawn with — read once per draw from the CSS custom
// properties styles.css defines per theme (see readPalette()), never
// hardcoded here. This is what lets the multiplayer/lobby-preview canvas
// follow the active theme the same way every other surface does, instead of
// keeping the dark "arena" look regardless of theme.
export interface ArenaPalette {
  readonly boardBg: string;
  readonly gridLine: string;
  readonly food: string;
  readonly mineHead: string;
  readonly mineBody: string;
  // Unitless 0-100 numbers (not CSS percentage strings) — colorFor() drops
  // them straight into an `hsl()` string alongside the per-snake hue.
  readonly otherSaturation: number;
  readonly otherLightnessHead: number;
  readonly otherLightnessBody: number;
}

const FALLBACK_PALETTE: ArenaPalette = {
  boardBg: "#0b0f14",
  gridLine: "rgba(255, 255, 255, 0.04)",
  food: "#ffb454",
  mineHead: "#39ff8f",
  mineBody: "#1fae5f",
  otherSaturation: 85,
  otherLightnessHead: 60,
  otherLightnessBody: 38,
};

// Reads the board palette for whichever theme is currently active on
// <html> — a plain DOM read, not a cached value, so a caller that calls
// this again after a theme change (see theme.ts's "themechange" event)
// always gets the current palette. Falls back to the dark-theme values
// (duplicated here only as a last resort) if called somewhere the CSS
// custom properties aren't available at all, e.g. a non-browser test
// environment.
export function readPalette(root: HTMLElement = document.documentElement): ArenaPalette {
  if (typeof getComputedStyle !== "function") return FALLBACK_PALETTE;
  const styles = getComputedStyle(root);
  const read = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  const readNumber = (name: string, fallback: number): number => {
    const raw = read(name, String(fallback));
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    boardBg: read("--board-bg", FALLBACK_PALETTE.boardBg),
    gridLine: read("--board-grid", FALLBACK_PALETTE.gridLine),
    food: read("--food", FALLBACK_PALETTE.food),
    mineHead: read("--mine-head", FALLBACK_PALETTE.mineHead),
    mineBody: read("--mine-body", FALLBACK_PALETTE.mineBody),
    otherSaturation: readNumber("--other-snake-saturation", FALLBACK_PALETTE.otherSaturation),
    otherLightnessHead: readNumber("--other-snake-lightness-head", FALLBACK_PALETTE.otherLightnessHead),
    otherLightnessBody: readNumber("--other-snake-lightness-body", FALLBACK_PALETTE.otherLightnessBody),
  };
}

// A new render function, not a change to render.ts: single-player's
// renderer stays exactly as it was (one snake, no "mine" concept), and this
// one draws a SerializedArena (many snakes, each already flagged `isMine`
// by the server — never computed here from anything client-side).
export function renderArena(
  ctx: CanvasRenderingContext2D,
  state: SerializedArena,
  cellPx: number,
  palette: ArenaPalette = FALLBACK_PALETTE,
): void {
  const sizePx = state.gridSize * cellPx;

  ctx.fillStyle = palette.boardBg;
  ctx.fillRect(0, 0, sizePx, sizePx);

  ctx.strokeStyle = palette.gridLine;
  ctx.lineWidth = 1;
  for (let i = 1; i < state.gridSize; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellPx, 0);
    ctx.lineTo(i * cellPx, sizePx);
    ctx.moveTo(0, i * cellPx);
    ctx.lineTo(sizePx, i * cellPx);
    ctx.stroke();
  }

  ctx.fillStyle = palette.food;
  const foodPad = cellPx * 0.18;
  const previousFoodAlpha = ctx.globalAlpha;
  for (const food of state.food) {
    // A death-food cell in its final few seconds blinks — driven entirely by
    // its own server-authoritative ticksRemaining (even/odd), not a client
    // timer, so every client blinks it in lockstep and in sync with the only
    // thing that actually redraws this canvas: the next SSE frame. No
    // requestAnimationFrame loop, no extra state — the existing once-per-tick
    // redraw already supplies the "frame" a blink needs.
    ctx.globalAlpha = isFoodExpiring(food) && food.ticksRemaining % 2 === 0 ? previousFoodAlpha * 0.25 : previousFoodAlpha;
    ctx.beginPath();
    ctx.arc(food.x * cellPx + cellPx / 2, food.y * cellPx + cellPx / 2, cellPx / 2 - foodPad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = previousFoodAlpha;

  let otherIndex = 0;
  for (const snake of state.snakes) {
    const [headColor, bodyColor] = snake.isMine
      ? ([palette.mineHead, palette.mineBody] as const)
      : colorFor(otherIndex++, palette);
    snake.segments.forEach((segment, index) => {
      ctx.fillStyle = index === 0 ? headColor : bodyColor;
      const pad = cellPx * 0.08;
      ctx.fillRect(segment.x * cellPx + pad, segment.y * cellPx + pad, cellPx - pad * 2, cellPx - pad * 2);
    });
  }

  // Eliminated snakes mid-fade: same body rendering, just faded by the
  // server-computed opacity — no explosion/fragmentation, just a subtle
  // disappearance everyone in the room sees identically (see arena.ts's
  // DyingSnake/opacity). globalAlpha is restored immediately after so it
  // never bleeds into anything drawn next frame.
  const previousAlpha = ctx.globalAlpha;
  let otherDyingIndex = 0;
  for (const snake of state.dying) {
    const [headColor, bodyColor] = snake.isMine
      ? ([palette.mineHead, palette.mineBody] as const)
      : colorFor(otherDyingIndex++, palette);
    ctx.globalAlpha = previousAlpha * Math.max(0, Math.min(1, snake.opacity));
    snake.segments.forEach((segment, index) => {
      ctx.fillStyle = index === 0 ? headColor : bodyColor;
      const pad = cellPx * 0.08;
      ctx.fillRect(segment.x * cellPx + pad, segment.y * cellPx + pad, cellPx - pad * 2, cellPx - pad * 2);
    });
  }
  ctx.globalAlpha = previousAlpha;
}

// Spread by a fixed angle rather than picked from a short fixed palette, so
// colors stay visually distinct from each other (not from "mine") no matter
// how many other players happen to be in the arena at once. The hue formula
// itself doesn't change per theme — only the saturation/lightness pair does
// (palette.otherSaturation/otherLightnessHead/otherLightnessBody), since a
// light board needs darker/more-saturated colors for contrast than a dark
// one does. Exported so the page's own players-list swatches match the
// canvas exactly, rather than keeping a second copy of the same formula.
export function colorFor(index: number, palette: ArenaPalette = FALLBACK_PALETTE): readonly [string, string] {
  const hue = (index * 67) % 360;
  const s = palette.otherSaturation;
  return [`hsl(${hue}, ${s}%, ${palette.otherLightnessHead}%)`, `hsl(${hue}, ${s}%, ${palette.otherLightnessBody}%)`];
}
