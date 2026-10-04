import type { APIRoute } from "astro";
import { deletePlayerPermanently } from "../../../lib/db";
import { clearSession, getExistingPlayer } from "../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Permanently deletes every game row and the player row itself for whoever
// this session cookie belongs to, then clears that cookie. There is no
// player id anywhere in this route — not in the URL, not read from a body —
// so a request has no parameter to misdirect at someone else's identity;
// "who" is only ever the caller's own session.
export const DELETE: APIRoute = ({ cookies }) => {
  const player = getExistingPlayer(cookies);
  if (!player) {
    return jsonResponse(404, { ok: false, reason: "no player session found" });
  }

  deletePlayerPermanently(player.id);
  clearSession(cookies);
  return jsonResponse(200, { ok: true });
};
