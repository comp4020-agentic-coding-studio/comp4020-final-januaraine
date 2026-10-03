import type { APIRoute } from "astro";
import { getOrCreatePlayer } from "../../lib/session";

// Mints (or confirms) the caller's anonymous player identity and hands back
// their display name — nothing else, since the session cookie itself is
// httpOnly and already set by getOrCreatePlayer. Every page that needs an
// identity (play.astro, leaderboard highlighting) can call this instead of
// duplicating the cookie dance, and it's also the explicit "player/session
// creation" endpoint the backend is expected to expose.
export const GET: APIRoute = ({ cookies }) => {
  const player = getOrCreatePlayer(cookies);
  return new Response(JSON.stringify({ displayName: player.displayName }), {
    headers: { "content-type": "application/json" },
  });
};
