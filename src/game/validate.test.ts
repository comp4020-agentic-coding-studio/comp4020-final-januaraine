import { describe, expect, it } from "vitest";
import { MAX_TICKS, POINTS_PER_FOOD } from "./config";
import { validateGameResult } from "./validate";

describe("validateGameResult", () => {
  it("accepts a plausible result", () => {
    expect(validateGameResult({ score: 30, ticks: 50 })).toEqual({ ok: true });
  });

  it("accepts a fresh game with no food eaten", () => {
    expect(validateGameResult({ score: 0, ticks: 0 })).toEqual({ ok: true });
  });

  it("rejects a negative score", () => {
    const result = validateGameResult({ score: -10, ticks: 5 });
    expect(result.ok).toBe(false);
  });

  it("rejects a score that isn't a multiple of the per-food award", () => {
    const result = validateGameResult({ score: POINTS_PER_FOOD + 1, ticks: 5 });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer score or ticks", () => {
    expect(validateGameResult({ score: 10.5, ticks: 5 }).ok).toBe(false);
    expect(validateGameResult({ score: 10, ticks: 5.5 }).ok).toBe(false);
  });

  it("rejects negative ticks", () => {
    expect(validateGameResult({ score: 0, ticks: -1 }).ok).toBe(false);
  });

  it("rejects ticks beyond the maximum allowed for a single game", () => {
    expect(validateGameResult({ score: 0, ticks: MAX_TICKS + 1 }).ok).toBe(false);
  });

  it("rejects a score higher than this many ticks could ever produce — the actual spoofing attempt", () => {
    // At most one food per tick, so 1 tick can never justify a score of 999,990.
    const result = validateGameResult({ score: 999_990, ticks: 1 });
    expect(result.ok).toBe(false);
  });

  it("accepts the tight boundary of exactly one food per tick", () => {
    expect(validateGameResult({ score: 5 * POINTS_PER_FOOD, ticks: 5 }).ok).toBe(true);
  });
});
