import type { APIRoute } from "astro";
import { becomePlayer } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The mid-session Viewer -> Player upgrade (room creation's own auto-join
// and the lobby's initial join.ts cover the other two ways to become a
// Player). Rejected (409) if the room is locked for anyone but its creator,
// or already has five Players — capacity/lock are re-checked here against
// the live room, never trusted from whatever the client last saw.
export const POST: APIRoute = ({ params, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) return jsonResponse(400, { ok: false, reason: "invalid room id" });

  const player = getOrCreatePlayer(cookies);
  const result = becomePlayer(roomId, player.id, player.displayName);
  if (!result.ok) return jsonResponse(409, { ok: false, reason: result.reason });
  return jsonResponse(200, { ok: true });
};
