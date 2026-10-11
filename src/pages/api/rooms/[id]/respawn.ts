import type { APIRoute } from "astro";
import { requestRoomRespawn } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Re-enters the caller's own membership as a fresh snake after elimination —
// only valid for someone already a Player in this room (an eliminated
// Player keeps their membership/role; only their snake is gone). A Viewer
// calling this is rejected, not silently turned into a Player.
export const POST: APIRoute = ({ params, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) return jsonResponse(400, { ok: false, reason: "invalid room id" });

  const player = getOrCreatePlayer(cookies);
  const result = requestRoomRespawn(roomId, player.id, player.displayName);
  if (!result.ok) return jsonResponse(409, { ok: false, reason: result.reason });
  return jsonResponse(200, { ok: true });
};
