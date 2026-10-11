import type { APIRoute } from "astro";
import { joinRoom } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface JoinBody {
  role?: unknown;
}

// The lobby's role-selector confirms here. The client's role choice is never
// silently changed: a "player" request that fails capacity/lock, or a
// "viewer" request that fails allowViewers, comes back as a rejection the
// client surfaces as-is, not a fallback to the other role.
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) return jsonResponse(400, { ok: false, reason: "invalid room id" });

  let body: JoinBody;
  try {
    body = (await request.json()) as JoinBody;
  } catch {
    return jsonResponse(400, { ok: false, reason: "body must be JSON" });
  }
  if (body.role !== "player" && body.role !== "viewer") {
    return jsonResponse(400, { ok: false, reason: "role must be \"player\" or \"viewer\"" });
  }

  const player = getOrCreatePlayer(cookies);
  const result = joinRoom(roomId, player.id, player.displayName, body.role);
  if (!result.ok) return jsonResponse(409, { ok: false, reason: result.reason });
  return jsonResponse(200, { ok: true });
};
