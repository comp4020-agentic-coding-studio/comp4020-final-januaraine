import { describe, expect, it } from "vitest";
import { createInitialState, startGame } from "./state";

describe("createInitialState", () => {
  it("produces a fresh, un-started board", () => {
    const state = createInitialState(10, () => 0);
    expect(state.status).toBe("ready");
    expect(state.score).toBe(0);
    expect(state.ticks).toBe(0);
    expect(state.snake).toHaveLength(1);
    expect(state.snake[0]).toEqual({ x: 5, y: 5 }); // centre of a 10x10 grid
  });

  it("never places food on top of the starting snake", () => {
    const state = createInitialState(10, () => 0);
    expect(state.food).not.toEqual(state.snake[0]);
  });
});

describe("startGame", () => {
  it("moves a ready game to playing", () => {
    const ready = createInitialState(10, () => 0);
    expect(startGame(ready).status).toBe("playing");
  });

  it("is a no-op once the game is already playing or over", () => {
    const ready = createInitialState(10, () => 0);
    const playing = startGame(ready);
    expect(startGame(playing)).toBe(playing);
    const over = { ...playing, status: "over" as const };
    expect(startGame(over)).toBe(over);
  });
});
