import { TICK_MS } from "../game/config";
import { setDirection, tick } from "../game/rules";
import { createInitialState, startGame } from "../game/state";
import type { Direction, GameState } from "../game/types";
import { attachKeyboardControls } from "./input";
import { render } from "./render";

export interface GameLoopHandle {
  /** Moves a "ready" game into "playing" and starts the tick interval. */
  start(): void;
  /** Resets to a fresh "ready" board — does not start it. */
  restart(): void;
  stop(): void;
}

export interface GameLoopOptions {
  canvas: HTMLCanvasElement;
  cellPx: number;
  onStateChange: (state: GameState) => void;
  onGameOver: (state: GameState) => void;
}

// Owns the one mutable thing in the whole client: the current GameState. It
// never computes a next state itself — every transition goes through
// game/rules.ts's tick()/setDirection() and game/state.ts's
// createInitialState()/startGame(), the same functions the unit tests call
// directly. Swapping this for "send input to the server, render whatever
// state it broadcasts" (C9) replaces this file; it doesn't touch game/*.
export function createGameLoop(options: GameLoopOptions): GameLoopHandle {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");

  let state: GameState = createInitialState();
  let intervalId: ReturnType<typeof setInterval> | null = null;

  const draw = (): void => render(ctx, state, options.cellPx);
  const publish = (): void => {
    options.onStateChange(state);
    draw();
  };

  const stopInterval = (): void => {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = null;
  };

  const runTick = (): void => {
    state = tick(state);
    publish();
    if (state.status === "over") {
      stopInterval();
      options.onGameOver(state);
    }
  };

  function start(): void {
    if (state.status !== "ready") return;
    state = startGame(state);
    publish();
    intervalId = setInterval(runTick, TICK_MS);
  }

  function restart(): void {
    stopInterval();
    state = createInitialState();
    publish();
  }

  const detachKeyboard = attachKeyboardControls((direction: Direction) => {
    // A direction key is also how a "ready" board begins — one keystroke
    // both starts the game and sets its first direction, which is the move
    // a player trying the game for the first time naturally makes.
    if (state.status === "ready") start();
    state = setDirection(state, direction);
  });

  publish();

  return {
    start,
    restart,
    stop(): void {
      stopInterval();
      detachKeyboard();
    },
  };
}
