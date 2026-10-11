import type { SerializedArena } from "../game/arena";
import type { Direction } from "../game/types";
import { attachKeyboardControls } from "./input";
import { renderArena } from "./arena-render";

export interface ArenaClientOptions {
  canvas: HTMLCanvasElement;
  cellPx: number;
  onState: (state: SerializedArena) => void;
  // Fires once per elimination — detected as "my snake was in the previous
  // frame, isn't in this one" — with the score it ended on.
  onEliminated: (finalScore: number) => void;
}

export interface ArenaClientHandle {
  stop(): void;
  /** The same validated-direction POST keyboard input already drives —
   *  exposed so the D-pad goes through this one path, never a second one. */
  sendDirection(direction: Direction): void;
}

// The realtime seam on the client: an EventSource for the server's broadcast
// (its built-in auto-reconnect is the browser-side half of "reconnecting
// while the game is still running" — see ADR-001) and a POST per direction
// change, reusing the same keyToDirection/attachKeyboardControls
// single-player's loop.ts already uses. Never computes a next state itself;
// every frame it draws is exactly what the server sent.
export function createArenaClient(options: ArenaClientOptions): ArenaClientHandle {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");

  let lastKnownScore = 0;
  let present = false;

  const source = new EventSource("/api/arena/stream");
  source.onmessage = (event: MessageEvent<string>) => {
    const state = JSON.parse(event.data) as SerializedArena;
    renderArena(ctx, state, options.cellPx);
    options.onState(state);

    const mine = state.snakes.find((s) => s.isMine);
    if (mine) {
      present = true;
      lastKnownScore = mine.score;
    } else if (present) {
      present = false;
      options.onEliminated(lastKnownScore);
    }
  };

  function sendDirection(direction: Direction): void {
    void fetch("/api/arena/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction }),
    });
  }

  const detachKeyboard = attachKeyboardControls(sendDirection);

  return {
    sendDirection,
    stop(): void {
      detachKeyboard();
      source.close();
    },
  };
}

export async function respawn(): Promise<void> {
  await fetch("/api/arena/respawn", { method: "POST" });
}
