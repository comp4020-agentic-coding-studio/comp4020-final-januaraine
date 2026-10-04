import type { APIRoute } from "astro";
import { hidePlayerFromLeaderboard } from "../../../lib/db";
import { getExistingPlayer } from "../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The only way to remove a leaderboard entry — and, by construction, the
// only way to prove it can't be done to someone else's: there is no player
// id anywhere in this route (not in the URL, not read from the body), only
// "me" as decided by the session cookie. A request can't target another
// player's entry because there is no parameter for it to supply.
export const DELETE: APIRoute = ({ cookies }) => {
  const player = getExistingPlayer(cookies);
  if (!player) {
    return jsonResponse(404, { ok: false, reason: "no player session found" });
  }

  hidePlayerFromLeaderboard(player.id);
  return jsonResponse(200, { ok: true });
};
