// The multiplayer-rooms counterpart to the old single-arena arena-server.ts:
// one module-level registry of RoomRuntimes instead of one module-level
// ArenaState. Each room wraps an unchanged src/game/arena.ts ArenaState — the
// game core itself needed no changes to go from "one shared arena" to "many
// independent arenas, one per room" (see
// docs/decisions/ADR-002-room-based-multiplayer.md). One Fly machine, one
// Node process (fly.toml's --ha=false), so — same as before — a module-level
// Map is the whole story: no pub/sub, no cross-instance fan-out.
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
import { createRoom, deleteRoom, recordGameResult } from "./db";

// Overridable so spec/rooms.test.ts doesn't have to wait out a real-world
// grace window to prove the disconnect/creator-departure rules.
const DISCONNECT_GRACE_MS = Number(process.env.ARENA_DISCONNECT_GRACE_MS) || 5000;

export const MAX_PLAYERS = 5;

export type MemberRole = "player" | "viewer";

interface Member {
  role: MemberRole;
  readonly displayName: string;
  readonly connections: Set<number>;
}

interface RoomConnection {
  readonly roomId: number;
  readonly playerId: number;
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
}

interface RoomRuntime {
  readonly id: number;
  name: string;
  locked: boolean;
  allowViewers: boolean;
  readonly creatorPlayerId: number;
  arena: ArenaState;
  readonly members: Map<number, Member>;
  readonly connections: Map<number, RoomConnection>;
  tickTimer: ReturnType<typeof setInterval> | null;
  readonly disconnectTimers: Map<number, ReturnType<typeof setTimeout>>;
}

const rooms = new Map<number, RoomRuntime>();
let nextConnectionId = 1;
const encoder = new TextEncoder();

export interface RoomSummary {
  readonly id: number;
  readonly name: string;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly viewerCount: number;
  readonly locked: boolean;
  readonly allowViewers: boolean;
  // Per-viewer, same "isMine" pattern the leaderboard and arena already use:
  // whether *this* caller is the room's creator, for whom `locked` doesn't
  // block becoming a Player. Lets the lobby's role-selector show an accurate
  // enabled/disabled state for the one case a room-agnostic summary can't
  // otherwise know.
  readonly youAreCreator: boolean;
}

function playerCount(runtime: RoomRuntime): number {
  let count = 0;
  for (const member of runtime.members.values()) if (member.role === "player") count++;
  return count;
}

function viewerCount(runtime: RoomRuntime): number {
  let count = 0;
  for (const member of runtime.members.values()) if (member.role === "viewer") count++;
  return count;
}

function summarize(runtime: RoomRuntime, viewerPlayerId?: number): RoomSummary {
  return {
    id: runtime.id,
    name: runtime.name,
    playerCount: playerCount(runtime),
    maxPlayers: MAX_PLAYERS,
    viewerCount: viewerCount(runtime),
    locked: runtime.locked,
    allowViewers: runtime.allowViewers,
    youAreCreator: viewerPlayerId !== undefined && viewerPlayerId === runtime.creatorPlayerId,
  };
}

// Listed for the lobby's live feed — only rooms that actually have a live
// runtime right now, which is every room in the DB (see db.ts's boot-time
// truncation: a DB row always has a matching runtime while the process is
// up) plus none that have already closed (closeRoom removes both at once).
export function listRoomSummaries(viewerPlayerId?: number): RoomSummary[] {
  return [...rooms.values()].map((runtime) => summarize(runtime, viewerPlayerId));
}

export function getRoomSummary(roomId: number, viewerPlayerId?: number): RoomSummary | null {
  const runtime = rooms.get(roomId);
  return runtime ? summarize(runtime, viewerPlayerId) : null;
}

// Only unlocked rooms that allow public viewers ever expose a preview — this
// is the one place that authorization is checked for the lobby's preview
// feed, so a caller can request a preview for any id it likes and a locked
// or viewer-disabled room's game state simply never comes back, regardless
// of what the UI happens to hide.
export function getRoomPreview(roomId: number, viewerPlayerId?: number): ReturnType<typeof serializeArena> | null {
  const runtime = rooms.get(roomId);
  if (!runtime || runtime.locked || !runtime.allowViewers) return null;
  return serializeArena(runtime.arena, viewerPlayerId);
}

export interface CreateRoomResult {
  ok: boolean;
  roomId?: number;
  reason?: string;
}

// Creates the DB row (the arbiter of name uniqueness) and the matching
// runtime together, then joins the creator as a Player automatically — the
// one place a Player join skips the usual lock/capacity check, because a
// brand-new room is by definition unlocked-for-its-own-creator and has zero
// Players in it.
export function createRoomAndJoinCreator(input: {
  name: string;
  creatorPlayerId: number;
  creatorDisplayName: string;
  locked: boolean;
  allowViewers: boolean;
}): CreateRoomResult {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 40) {
    return { ok: false, reason: "room name must be 1-40 characters" };
  }

  const created = createRoom({
    name,
    creatorPlayerId: input.creatorPlayerId,
    locked: input.locked,
    allowViewers: input.allowViewers,
  });
  if (!created.ok) return { ok: false, reason: created.reason };

  leaveOtherRooms(input.creatorPlayerId);

  const runtime: RoomRuntime = {
    id: created.room.id,
    name: created.room.name,
    locked: created.room.locked,
    allowViewers: created.room.allowViewers,
    creatorPlayerId: created.room.creatorPlayerId,
    arena: createArena(),
    members: new Map(),
    connections: new Map(),
    tickTimer: null,
    disconnectTimers: new Map(),
  };
  runtime.members.set(input.creatorPlayerId, {
    role: "player",
    displayName: input.creatorDisplayName,
    connections: new Set(),
  });
  runtime.arena = joinArena(runtime.arena, input.creatorPlayerId, input.creatorDisplayName);
  rooms.set(runtime.id, runtime);

  return { ok: true, roomId: runtime.id };
}

// A player can only ever be a member of one room at a time (see
// ADR-002) — joining a new room (or creating one) first tears down any
// existing membership elsewhere, exactly like an explicit "Leave Room".
// `exceptRoomId` excludes the room being joined itself: a same-room role
// switch must never go through leaveRoom's creator-closes-the-room rule,
// since the creator switching their own role isn't "the creator leaving".
function leaveOtherRooms(playerId: number, exceptRoomId?: number): void {
  for (const runtime of rooms.values()) {
    if (runtime.id === exceptRoomId) continue;
    if (runtime.members.has(playerId)) leaveRoom(runtime.id, playerId);
  }
}

export interface JoinResult {
  ok: boolean;
  reason?: string;
}

// The validated entry point from the lobby's role selector. Re-checks
// everything against the live runtime, never the caller's (possibly stale)
// lobby snapshot, and never silently substitutes a different role than the
// one requested — a rejected "player" request stays rejected, it does not
// fall back to "viewer".
export function joinRoom(
  roomId: number,
  playerId: number,
  displayName: string,
  role: MemberRole,
): JoinResult {
  const runtime = rooms.get(roomId);
  if (!runtime) return { ok: false, reason: "room not found" };

  const existing = runtime.members.get(playerId);
  if (existing?.role === role) return { ok: true };

  if (role === "player") {
    const isCreator = playerId === runtime.creatorPlayerId;
    if (runtime.locked && !isCreator) return { ok: false, reason: "players are locked" };
    if (playerCount(runtime) >= MAX_PLAYERS) return { ok: false, reason: "room is full" };
  } else if (!runtime.allowViewers) {
    return { ok: false, reason: "viewers are not allowed in this room" };
  }

  leaveOtherRooms(playerId, roomId);

  if (existing) {
    existing.role = role;
  } else {
    runtime.members.set(playerId, { role, displayName, connections: new Set() });
  }
  runtime.arena = role === "player" ? joinArena(runtime.arena, playerId, displayName) : leaveArena(runtime.arena, playerId);

  return { ok: true };
}

export const becomePlayer = (roomId: number, playerId: number, displayName: string): JoinResult => {
  const runtime = rooms.get(roomId);
  if (!runtime) return { ok: false, reason: "room not found" };
  const member = runtime.members.get(playerId);
  if (!member) return { ok: false, reason: "not a member of this room" };
  if (member.role === "player") return { ok: true };

  const isCreator = playerId === runtime.creatorPlayerId;
  if (runtime.locked && !isCreator) return { ok: false, reason: "players are locked" };
  if (playerCount(runtime) >= MAX_PLAYERS) return { ok: false, reason: "room is full" };

  member.role = "player";
  runtime.arena = joinArena(runtime.arena, playerId, displayName);
  return { ok: true };
};

export function becomeViewer(roomId: number, playerId: number): JoinResult {
  const runtime = rooms.get(roomId);
  if (!runtime) return { ok: false, reason: "room not found" };
  const member = runtime.members.get(playerId);
  if (!member) return { ok: false, reason: "not a member of this room" };
  if (member.role === "viewer") return { ok: true };

  member.role = "viewer";
  runtime.arena = leaveArena(runtime.arena, playerId);
  return { ok: true };
}

// Explicit "Leave Room" — immediate, no grace window (that's only for an
// unplanned disconnect). If the departing member is the room's creator,
// the whole room closes (see ADR-002's lifecycle policy): every other
// member's connection is told so (a distinct SSE event, not just a dropped
// stream) and then closed from the server side.
export function leaveRoom(roomId: number, playerId: number): void {
  const runtime = rooms.get(roomId);
  if (!runtime) return;
  if (!runtime.members.has(playerId)) return;

  if (playerId === runtime.creatorPlayerId) {
    closeRoom(roomId, "creator left");
    return;
  }

  runtime.members.delete(playerId);
  runtime.arena = leaveArena(runtime.arena, playerId);
  const timer = runtime.disconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    runtime.disconnectTimers.delete(playerId);
  }
  broadcastRoom(runtime);
  stopTickLoopIfIdle(runtime);
}

function closeRoom(roomId: number, reason: string): void {
  const runtime = rooms.get(roomId);
  if (!runtime) return;

  const message = encoder.encode(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
  for (const connection of runtime.connections.values()) {
    try {
      connection.controller.enqueue(message);
      connection.controller.close();
    } catch {
      // Already gone — nothing left to tell.
    }
  }
  if (runtime.tickTimer) clearInterval(runtime.tickTimer);
  for (const timer of runtime.disconnectTimers.values()) clearTimeout(timer);

  rooms.delete(roomId);
  deleteRoom(roomId);
}

export interface RoomMemberView {
  readonly displayName: string;
  readonly role: MemberRole;
  readonly connected: boolean;
  readonly isMine: boolean;
}

function membersView(runtime: RoomRuntime, viewerPlayerId?: number): RoomMemberView[] {
  return [...runtime.members.entries()].map(([playerId, member]) => ({
    displayName: member.displayName,
    role: member.role,
    connected: member.connections.size > 0,
    isMine: playerId === viewerPlayerId,
  }));
}

// The one payload the room's SSE stream ever sends: the arena (positions,
// food, scores — each snake's own `isMine` computed server-side, same
// pattern the old single arena used) alongside membership and room
// metadata, so the room page's Players/Viewers panels and lock/allowViewers
// state never need a second polled endpoint.
export interface RoomFrame {
  readonly room: { readonly id: number; readonly name: string; readonly locked: boolean; readonly allowViewers: boolean };
  readonly arena: ReturnType<typeof serializeArena>;
  readonly members: readonly RoomMemberView[];
  readonly yourRole: MemberRole;
}

function buildFrame(runtime: RoomRuntime, viewerPlayerId: number): RoomFrame {
  return {
    room: { id: runtime.id, name: runtime.name, locked: runtime.locked, allowViewers: runtime.allowViewers },
    arena: serializeArena(runtime.arena, viewerPlayerId),
    members: membersView(runtime, viewerPlayerId),
    yourRole: runtime.members.get(viewerPlayerId)?.role ?? "viewer",
  };
}

function frameFor(runtime: RoomRuntime, viewerPlayerId: number): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(buildFrame(runtime, viewerPlayerId))}\n\n`);
}

function broadcastRoom(runtime: RoomRuntime): void {
  for (const [id, connection] of runtime.connections) {
    try {
      connection.controller.enqueue(frameFor(runtime, connection.playerId));
    } catch {
      runtime.connections.delete(id);
    }
  }
}

function ensureTickLoopRunning(runtime: RoomRuntime): void {
  if (runtime.tickTimer !== null) return;
  runtime.tickTimer = setInterval(() => runTick(runtime), TICK_MS);
}

function stopTickLoopIfIdle(runtime: RoomRuntime): void {
  if (runtime.connections.size > 0 || runtime.tickTimer === null) return;
  clearInterval(runtime.tickTimer);
  runtime.tickTimer = null;
}

function runTick(runtime: RoomRuntime): void {
  const { state: next, eliminated } = tickArena(runtime.arena);
  runtime.arena = next;

  for (const result of eliminated) {
    if (!validateGameResult({ score: result.score, ticks: result.ticks }).ok) continue;
    recordGameResult({ playerId: result.playerId, score: result.score, ticks: result.ticks });
  }

  broadcastRoom(runtime);
  stopTickLoopIfIdle(runtime);
}

export interface StreamResult {
  ok: boolean;
  connectionId?: number;
  reason?: string;
}

// Called once per opened /api/rooms/[id]/stream connection. The caller must
// already be a member (via joinRoom/becomePlayer/becomeViewer, or still
// present from before a reconnect) — this never mints new membership itself,
// same separation as the old arena-server.ts kept between "join" and "open
// the stream".
export function registerRoomConnection(
  roomId: number,
  playerId: number,
  controller: ReadableStreamDefaultController<Uint8Array>,
): StreamResult {
  const runtime = rooms.get(roomId);
  if (!runtime) return { ok: false, reason: "room not found" };
  if (!runtime.members.has(playerId)) return { ok: false, reason: "not a member of this room" };

  const pendingRemoval = runtime.disconnectTimers.get(playerId);
  if (pendingRemoval) {
    clearTimeout(pendingRemoval);
    runtime.disconnectTimers.delete(playerId);
  }

  const connectionId = nextConnectionId++;
  runtime.connections.set(connectionId, { roomId, playerId, controller });
  runtime.members.get(playerId)!.connections.add(connectionId);
  ensureTickLoopRunning(runtime);

  controller.enqueue(frameFor(runtime, playerId));

  return { ok: true, connectionId };
}

// Disconnect grace applies to every member, not just Players — a Viewer's
// tab closing shouldn't instantly disappear them from the member list either
// (a network blip looks the same from the server's side regardless of
// role). Only a Player disconnecting can ever cost them their snake; only
// the *creator* disconnecting can ever cost the room its existence.
export function unregisterRoomConnection(connectionId: number): void {
  for (const runtime of rooms.values()) {
    const connection = runtime.connections.get(connectionId);
    if (!connection) continue;
    runtime.connections.delete(connectionId);

    const member = runtime.members.get(connection.playerId);
    member?.connections.delete(connectionId);

    const stillConnected = member && member.connections.size > 0;
    if (!stillConnected && !runtime.disconnectTimers.has(connection.playerId)) {
      const timer = setTimeout(() => {
        runtime.disconnectTimers.delete(connection.playerId);
        if (connection.playerId === runtime.creatorPlayerId) {
          closeRoom(runtime.id, "creator disconnected");
          return;
        }
        runtime.members.delete(connection.playerId);
        runtime.arena = leaveArena(runtime.arena, connection.playerId);
        broadcastRoom(runtime);
        stopTickLoopIfIdle(runtime);
      }, DISCONNECT_GRACE_MS);
      runtime.disconnectTimers.set(connection.playerId, timer);
    }

    stopTickLoopIfIdle(runtime);
    return;
  }
}

export function submitRoomInput(roomId: number, playerId: number, direction: unknown): void {
  if (!isDirection(direction)) return;
  const runtime = rooms.get(roomId);
  if (!runtime) return;
  const member = runtime.members.get(playerId);
  if (!member || member.role !== "player") return;
  runtime.arena = setArenaDirection(runtime.arena, playerId, direction);
}

export function requestRoomRespawn(roomId: number, playerId: number, displayName: string): JoinResult {
  const runtime = rooms.get(roomId);
  if (!runtime) return { ok: false, reason: "room not found" };
  const member = runtime.members.get(playerId);
  if (!member || member.role !== "player") return { ok: false, reason: "not a player in this room" };
  runtime.arena = joinArena(runtime.arena, playerId, displayName);
  return { ok: true };
}

export function listRoomMembers(roomId: number, viewerPlayerId?: number): RoomMemberView[] | null {
  const runtime = rooms.get(roomId);
  return runtime ? membersView(runtime, viewerPlayerId) : null;
}

export function getMemberRole(roomId: number, playerId: number): MemberRole | null {
  return rooms.get(roomId)?.members.get(playerId)?.role ?? null;
}

export function roomRuntimeExists(roomId: number): boolean {
  return rooms.has(roomId);
}
