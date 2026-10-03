import type { APIRoute } from "astro";
import { listLeaderboard } from "../../lib/db";

// Read-only, and public: a leaderboard that only you could see wouldn't be
// one. Used both by leaderboard.astro (server-rendered on load) and by
// play.astro's client script (re-fetched after a game ends, so a new result
// shows up without a full page reload).
export const GET: APIRoute = () => {
  const entries = listLeaderboard(10);
  return new Response(JSON.stringify({ entries }), { headers: { "content-type": "application/json" } });
};
