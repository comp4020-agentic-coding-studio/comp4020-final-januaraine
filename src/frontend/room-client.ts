import { attachKeyboardControls } from "./input";
import { renderArena } from "./arena-render";
import type { RoomFrame } from "../lib/room-server";
import type { Direction } from "../game/types";

export interface RoomClientOptions {
  roomId: number;
  canvas: HTMLCanvasElement;
  cellPx: number;
  onFrame: (frame: RoomFrame) => void;
  onEliminated: (finalScore: number) => void;
  onClosed: (reason: string) => void;
}

export interface RoomClientHandle {
  stop(): void;
  sendDirection(direction: Direction): void;
}

// Room-scoped counterpart of the old single-arena arena-client.ts: one
// EventSource per open room page (the server's broadcast), one POST per
// direction change. Still never computes a next frame itself — every draw
// is exactly the RoomFrame the server sent. Keyboard/D-pad input is only
// ever wired up by the caller when the viewer is currently a Player (see
// room/[id].astro) — this module itself has no role concept, it just sends
// whatever direction it's given and the server is the one that silently
// ignores a Viewer's input (src/lib/room-server.ts's submitRoomInput).
export function createRoomClient(options: RoomClientOptions): RoomClientHandle {
  const ctx = options.canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2D context unavailable");

  let lastKnownScore = 0;
  let present = false;

  const source = new EventSource(`/api/rooms/${options.roomId}/stream`);
  source.onmessage = (event: MessageEvent<string>) => {
    const frame = JSON.parse(event.data) as RoomFrame;
    renderArena(ctx, frame.arena, options.cellPx);
    options.onFrame(frame);

    const mine = frame.arena.snakes.find((s) => s.isMine);
    if (mine) {
      present = true;
      lastKnownScore = mine.score;
    } else if (present && frame.yourRole === "player") {
      present = false;
      options.onEliminated(lastKnownScore);
    }
  };
  source.addEventListener("rejected", (event) => {
    const parsed = JSON.parse((event as MessageEvent<string>).data) as { reason?: string };
    options.onClosed(parsed.reason ?? "This room is no longer available.");
  });
  source.addEventListener("closed", (event) => {
    const parsed = JSON.parse((event as MessageEvent<string>).data) as { reason?: string };
    options.onClosed(parsed.reason ?? "This room was closed.");
  });

  function sendDirection(direction: Direction): void {
    void fetch(`/api/rooms/${options.roomId}/input`, {
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

async function postAction(roomId: number, action: string): Promise<{ ok: boolean; reason?: string }> {
  // "content-type: application/json" marks this as script-driven even with
  // no body — same convention leaderboard.astro's delete-my-data fetch uses,
  // so Astro's CSRF origin check never has reason to treat it as a form post.
  const res = await fetch(`/api/rooms/${roomId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  return (await res.json().catch(() => ({ ok: res.ok }))) as { ok: boolean; reason?: string };
}

export const respawn = (roomId: number) => postAction(roomId, "respawn");
export const becomeViewer = (roomId: number) => postAction(roomId, "become-viewer");
export const becomePlayer = (roomId: number) => postAction(roomId, "become-player");
export const leaveRoom = (roomId: number) => postAction(roomId, "leave");
export const joinRoom = (roomId: number, role: "player" | "viewer") =>
  fetch(`/api/rooms/${roomId}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role }),
  }).then((res) => res.json() as Promise<{ ok: boolean; reason?: string }>);
