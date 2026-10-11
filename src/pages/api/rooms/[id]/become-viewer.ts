import type { APIRoute } from "astro";
import { becomeViewer } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Always allowed for an existing member — one of the three post-death
// options (Respawn / Become Viewer / Leave Room), and also usable any time a
// Player simply wants to stop playing without leaving the room entirely.
export const POST: APIRoute = ({ params, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) return jsonResponse(400, { ok: false, reason: "invalid room id" });

  const player = getOrCreatePlayer(cookies);
  const result = becomeViewer(roomId, player.id);
  if (!result.ok) return jsonResponse(409, { ok: false, reason: result.reason });
  return jsonResponse(200, { ok: true });
};
