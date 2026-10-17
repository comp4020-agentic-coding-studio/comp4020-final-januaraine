import type { EliminationReason, FoodSource } from "../game/arena";

// C10: structured logs plus a small set of in-process counters. This is
// intentionally not a logging framework or a metrics platform — one Fly
// machine with no sidecar is the whole deployment, so a JSON line to stdout
// (readable with `flyctl logs`) and a plain in-memory tally (readable at
// /api/metrics, see pages/api/metrics.ts) are already the right size for
// "can the developer tell what the system is doing," which is the entire
// brief here. Event names are this app's own vocabulary (rooms, SSE) rather
// than the generic websocket/match shape the design doc sketches — see
// PROCESS.md's C10 entry for why.
export type ObservedEvent =
  | { readonly event: "player_connected"; readonly roomId: number; readonly playerId: number }
  | { readonly event: "player_disconnected"; readonly roomId: number; readonly playerId: number }
  | { readonly event: "room_created"; readonly roomId: number; readonly creatorPlayerId: number }
  | { readonly event: "room_closed"; readonly roomId: number; readonly reason: string }
  | {
      readonly event: "player_joined_room";
      readonly roomId: number;
      readonly playerId: number;
      readonly role: "player" | "viewer";
    }
  | { readonly event: "player_left_room"; readonly roomId: number; readonly playerId: number }
  | {
      readonly event: "food_collected";
      readonly roomId: number;
      readonly playerId: number;
      readonly source: FoodSource;
    }
  | {
      readonly event: "player_eliminated";
      readonly roomId: number;
      readonly playerId: number;
      readonly reason: EliminationReason;
      readonly score: number;
      readonly ticks: number;
    }
  | {
      readonly event: "game_finished";
      readonly roomId: number;
      readonly playerId: number;
      readonly score: number;
      readonly ticks: number;
    }
  | { readonly event: "sse_error"; readonly roomId: number | null; readonly detail: string }
  | { readonly event: "database_error"; readonly detail: string };

export function logEvent(e: ObservedEvent): void {
  console.log(JSON.stringify({ ...e, timestamp: new Date().toISOString() }));
}

export interface Counters {
  gamesStarted: number;
  gamesFinished: number;
  foodCollected: number;
  playerEliminations: number;
  sseDisconnects: number;
  sseErrors: number;
  databaseErrors: number;
}

// Module-level, in-memory, reset on every restart — the same tradeoff the
// app already makes for room/arena state (see ADR-002): not persisted
// because there's nothing durable to compare it against between restarts,
// only "what's happened since this process came up."
const counters: Counters = {
  gamesStarted: 0,
  gamesFinished: 0,
  foodCollected: 0,
  playerEliminations: 0,
  sseDisconnects: 0,
  sseErrors: 0,
  databaseErrors: 0,
};

export function incrementCounter(key: keyof Counters): void {
  counters[key]++;
}

export function getCounters(): Counters {
  return { ...counters };
}
