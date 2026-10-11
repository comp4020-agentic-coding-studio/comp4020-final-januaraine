import type { APIRoute } from "astro";
import { isDirection } from "../../../../game/types";
import { submitRoomInput } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface InputBody {
  direction?: unknown;
}

// Room-scoped counterpart of the old /api/arena/input: still just a
// direction, never a position, and submitRoomInput itself re-checks the
// caller is actually a Player in this room (a Viewer's input is silently
// ignored, not merely hidden in the UI).
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) return jsonResponse(400, { ok: false, reason: "invalid room id" });

  let body: InputBody;
  try {
    body = (await request.json()) as InputBody;
  } catch {
    return jsonResponse(400, { ok: false, reason: "body must be JSON" });
  }
  if (!isDirection(body.direction)) {
    return jsonResponse(400, { ok: false, reason: "direction must be one of up/down/left/right" });
  }

  const player = getOrCreatePlayer(cookies);
  submitRoomInput(roomId, player.id, body.direction);
  return jsonResponse(200, { ok: true });
};
