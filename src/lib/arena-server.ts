// The one place the shared arena's mutable, in-memory state actually lives —
// everything in src/game/arena.ts stays pure, this is the I/O shell around
// it: SSE connections, the server tick interval, and persistence of finished
// (eliminated) runs through the existing recordGameResult path. One Fly
// machine, one Node process (fly.toml's --ha=false), so a module-level
// singleton is the whole story: no pub/sub, no cross-instance fan-out to
// build (see docs/decisions/ADR-001-realtime-multiplayer.md).
import { TICK_MS } from "../game/config";
import {
  type ArenaState,
  createArena,
  joinArena,
  leaveArena,
  serializeArena,
  setArenaDirection,
  tickArena,
} from "../game/arena";
import { isDirection } from "../game/types";
import { validateGameResult } from "../game/validate";
import { recordGameResult } from "./db";

// Overridable so spec/arena.test.ts doesn't have to wait out a real-world
// grace window to prove the disconnect rule.
const DISCONNECT_GRACE_MS = Number(process.env.ARENA_DISCONNECT_GRACE_MS) || 5000;

interface Connection {
  readonly playerId: number;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
}

let state: ArenaState = createArena();
const connections = new Map<number, Connection>();
const disconnectTimers = new Map<number, ReturnType<typeof setTimeout>>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let nextConnectionId = 1;

const encoder = new TextEncoder();

// Framed per viewer, not once for everyone: serializeArena's `isMine` has to
// be computed relative to whoever is about to receive this frame (the same
// server-side "isMine" the leaderboard already computes from the session,
// never a client-asserted id).
function frameFor(viewerPlayerId: number): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(serializeArena(state, viewerPlayerId))}\n\n`);
}

function broadcast(): void {
  for (const [id, connection] of connections) {
    try {
      connection.controller.enqueue(frameFor(connection.playerId));
    } catch {
      // The underlying response is already gone (the client disconnected
      // between ticks); its own cancel() callback unregisters it — this is
      // just a stale enqueue losing the race, not a new failure to handle.
      connections.delete(id);
    }
  }
}

// Only ticks while someone is actually watching: an always-running interval
// would stop fly.toml's auto_stop_machines from ever seeing the machine as
// idle, which is most of why this app costs cents rather than dollars.
function ensureTickLoopRunning(): void {
  if (tickTimer !== null) return;
  tickTimer = setInterval(runTick, TICK_MS);
}

function stopTickLoopIfIdle(): void {
  if (connections.size > 0 || tickTimer === null) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

function runTick(): void {
  const { state: next, eliminated } = tickArena(state);
  state = next;

  // These scores/ticks were computed by this server's own tickArena() run,
  // never reported by a client — validateGameResult here is a sanity
  // assertion (see game/validate.ts's own comment anticipating exactly
  // this), not the defense it is for the single-player /api/games path.
  for (const result of eliminated) {
    if (!validateGameResult({ score: result.score, ticks: result.ticks }).ok) continue;
    recordGameResult({ playerId: result.playerId, score: result.score, ticks: result.ticks });
  }

  broadcast();
  stopTickLoopIfIdle();
}

// Called once per opened /api/arena/stream connection. Joining (if the
// player has no live snake) and cancelling any pending disconnect-grace
// timer both go through here, so a reconnect and a first connect are the
// same code path — see ADR-001 for why that's deliberate.
export function registerConnection(
  playerId: number,
  displayName: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
): number {
  const pendingRemoval = disconnectTimers.get(playerId);
  if (pendingRemoval) {
    clearTimeout(pendingRemoval);
    disconnectTimers.delete(playerId);
  }

  if (!state.snakes[playerId]) {
    state = joinArena(state, playerId, displayName);
  }

  const connectionId = nextConnectionId++;
  connections.set(connectionId, { playerId, controller });
  ensureTickLoopRunning();

  // Send the current frame immediately, so a just-opened connection doesn't
  // sit blank for up to one tick before its first state arrives.
  controller.enqueue(frameFor(playerId));

  return connectionId;
}

export function unregisterConnection(connectionId: number): void {
  const connection = connections.get(connectionId);
  if (!connection) return;
  connections.delete(connectionId);

  const anyConnectionLeftForPlayer = [...connections.values()].some((c) => c.playerId === connection.playerId);
  if (!anyConnectionLeftForPlayer && !disconnectTimers.has(connection.playerId)) {
    const timer = setTimeout(() => {
      disconnectTimers.delete(connection.playerId);
      state = leaveArena(state, connection.playerId);
    }, DISCONNECT_GRACE_MS);
    disconnectTimers.set(connection.playerId, timer);
  }

  stopTickLoopIfIdle();
}

// Ignores anything that isn't exactly one of the four directions, and
// anyone who isn't currently an arena participant (never joined, or already
// eliminated) — never trusted as anything more than "this player wants to
// try turning this way."
export function submitInput(playerId: number, direction: unknown): void {
  if (!isDirection(direction)) return;
  state = setArenaDirection(state, playerId, direction);
}

// Re-joins an eliminated player as a fresh snake. A no-op if they already
// have a live one (see joinArena) — this is also what a client accidentally
// double-clicking "respawn" hits.
export function requestRespawn(playerId: number, displayName: string): void {
  state = joinArena(state, playerId, displayName);
}
