import { MAX_TICKS, POINTS_PER_FOOD, TICK_MS } from "./config";

export interface GameResultInput {
  readonly score: number;
  readonly ticks: number;
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

// The server-side half of "don't trust the client's final score." C8 still
// runs the game loop in the browser, so this can't replay the match — but it
// doesn't need to, because the game's own rules bound what's reachable: at
// most one food per tick (rules.ts only ever awards POINTS_PER_FOOD once per
// tick() call), so score/POINTS_PER_FOOD can never exceed ticks. Anything
// past that bound is provably fabricated, not just suspicious.
//
// This is also exactly the function C9's authoritative server loop makes
// redundant rather than replaces: once the server runs tick() itself, the
// score it persists is simply the one it computed, and this bound becomes a
// sanity assertion instead of the whole defense.
export function validateGameResult(input: GameResultInput): ValidationResult {
  if (!Number.isInteger(input.score) || input.score < 0) {
    return { ok: false, reason: "score must be a non-negative integer" };
  }
  if (input.score % POINTS_PER_FOOD !== 0) {
    return { ok: false, reason: `score must be a multiple of ${POINTS_PER_FOOD}` };
  }
  if (!Number.isInteger(input.ticks) || input.ticks < 0) {
    return { ok: false, reason: "ticks must be a non-negative integer" };
  }
  if (input.ticks > MAX_TICKS) {
    return { ok: false, reason: `ticks exceeds the maximum of a single reported game (${MAX_TICKS})` };
  }
  const foodEaten = input.score / POINTS_PER_FOOD;
  if (foodEaten > input.ticks) {
    return { ok: false, reason: "score is higher than this many ticks could ever produce" };
  }
  return { ok: true };
}

export function ticksToMs(ticks: number): number {
  return ticks * TICK_MS;
}
