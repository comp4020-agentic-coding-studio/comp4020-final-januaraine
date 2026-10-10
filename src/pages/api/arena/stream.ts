import type { APIRoute } from "astro";
import { registerConnection, unregisterConnection } from "../../../lib/arena-server";
import { getOrCreatePlayer } from "../../../lib/session";

// The realtime channel: one long-lived Server-Sent Events response per
// connected client. Identity comes only from the existing session cookie
// (getOrCreatePlayer) — the same anonymous identity single-player already
// uses, not a new mechanism. Opening this is what "joining the arena" means;
// see ADR-001 for why a reconnect and a first join share this one path.
export const GET: APIRoute = ({ request, cookies }) => {
  const player = getOrCreatePlayer(cookies);

  let connectionId = -1;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connectionId = registerConnection(player.id, player.displayName, controller);
    },
    cancel() {
      unregisterConnection(connectionId);
    },
  });

  // Covers the case the client aborts the fetch outright rather than the
  // stream being cancelled from the reading side (e.g. a tab closed
  // mid-connection) — belt and suspenders with cancel() above, and
  // unregisterConnection is a safe no-op if called twice.
  request.signal.addEventListener("abort", () => unregisterConnection(connectionId));

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
};
