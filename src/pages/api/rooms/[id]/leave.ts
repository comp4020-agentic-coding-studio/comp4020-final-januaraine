import type { APIRoute } from "astro";
import { leaveRoom } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Explicit departure — immediate, no disconnect-grace window (that's only
// for an unplanned connection drop). If the caller is the room's creator,
// leaveRoom closes the whole room (see ADR-002's lifecycle policy); a
// non-creator leaving only removes their own membership.
export const POST: APIRoute = ({ params, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) return jsonResponse(400, { ok: false, reason: "invalid room id" });

  const player = getOrCreatePlayer(cookies);
  leaveRoom(roomId, player.id);
  return jsonResponse(200, { ok: true });
};
