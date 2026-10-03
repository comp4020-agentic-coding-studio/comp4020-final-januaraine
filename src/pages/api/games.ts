import type { APIRoute } from "astro";
import { validateGameResult } from "../../game/validate";
import { recordGameResult } from "../../lib/db";
import { getOrCreatePlayer } from "../../lib/session";

interface SubmitBody {
  score?: unknown;
  ticks?: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The one write path for a finished game. The client is never authoritative
// here in two separate ways: the player it's recorded against comes only
// from the session cookie (see session.ts — never a body field), and the
// score/ticks pair is bounds-checked against the game's own rules
// (validateGameResult) before anything is persisted. A request that fails
// either check writes nothing.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return jsonResponse(400, { ok: false, reason: "body must be JSON" });
  }

  const score = body.score;
  const ticks = body.ticks;
  if (typeof score !== "number" || typeof ticks !== "number") {
    return jsonResponse(400, { ok: false, reason: "score and ticks are both required numbers" });
  }

  const validation = validateGameResult({ score, ticks });
  if (!validation.ok) {
    return jsonResponse(400, { ok: false, reason: validation.reason });
  }

  const player = getOrCreatePlayer(cookies);
  const game = recordGameResult({ playerId: player.id, score, ticks });

  return jsonResponse(201, {
    ok: true,
    game: {
      id: game.id,
      displayName: player.displayName,
      score: game.score,
      survivalTimeMs: game.survivalTimeMs,
      finishedAt: game.finishedAt,
    },
  });
};
