import type { APIRoute } from "astro";
import { isDirection } from "../../../game/types";
import { submitInput } from "../../../lib/arena-server";
import { getOrCreatePlayer } from "../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface InputBody {
  direction?: unknown;
}

// The client sends intent, never a position: exactly the "direction" shape
// the technical design doc specifies, nothing else. A malformed or
// unrecognised value is rejected here (400) rather than silently ignored,
// so the contract is checkable — submitInput itself re-checks regardless,
// since it's reachable from code other than this one route too.
export const POST: APIRoute = async ({ request, cookies }) => {
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
  submitInput(player.id, body.direction);
  return jsonResponse(200, { ok: true });
};
