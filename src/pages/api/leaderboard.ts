import type { APIRoute } from "astro";
import { listLeaderboard, parseLeaderboardQuery } from "../../lib/db";
import { getExistingPlayer } from "../../lib/session";

// Read-only, and public: a leaderboard that only you could see wouldn't be
// one. Used both by leaderboard.astro (server-rendered on load) and by
// play.astro's client script (re-fetched after a game ends, so a new result
// shows up without a full page reload).
//
// Optional query filters — player, score, score range, date range — are all
// validated by the same parseLeaderboardQuery used by leaderboard.astro, so
// a malformed value (e.g. minScore=abc) is rejected the same way in both
// places instead of silently being ignored.
export const GET: APIRoute = ({ request, cookies }) => {
  const parsed = parseLeaderboardQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return new Response(JSON.stringify({ ok: false, errors: parsed.errors }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const currentPlayerId = getExistingPlayer(cookies)?.id ?? null;
  const entries = listLeaderboard({ ...parsed.filters, limit: 10, currentPlayerId });
  return new Response(JSON.stringify({ entries }), { headers: { "content-type": "application/json" } });
};
