import type { APIRoute } from "astro";
import { requestRespawn } from "../../../lib/arena-server";
import { getOrCreatePlayer } from "../../../lib/session";

// Re-enters the caller's own session as a fresh snake after elimination —
// identity still comes only from the session cookie, never a body field, so
// there's no way to respawn as anyone but yourself. A no-op (200) if the
// caller already has a live snake (see requestRespawn/joinArena).
export const POST: APIRoute = ({ cookies }) => {
  const player = getOrCreatePlayer(cookies);
  requestRespawn(player.id, player.displayName);
  return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
};
