import type { APIRoute } from "astro";
import { registerRoomConnection, unregisterRoomConnection } from "../../../../lib/room-server";
import { getOrCreatePlayer } from "../../../../lib/session";

// The realtime channel for one room. Unlike the lobby stream, this never
// mints membership itself — the caller must already be a Player or Viewer
// (via join.ts/become-player.ts/become-viewer.ts, or simply still a member
// from before a reconnect); opening this only resumes/observes, exactly the
// separation the old single-arena stream.ts kept between "join" and "open
// the stream".
export const GET: APIRoute = ({ params, request, cookies }) => {
  const roomId = Number(params.id);
  if (!Number.isInteger(roomId)) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid room id" }), { status: 400 });
  }

  const player = getOrCreatePlayer(cookies);

  let connectionId = -1;
  let rejected: string | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const result = registerRoomConnection(roomId, player.id, controller);
      if (!result.ok || result.connectionId === undefined) {
        rejected = result.reason ?? "unable to join room stream";
        // A custom event name, not "error" — the EventSource-reserved
        // "error" event is for transport-level failures (no `.data`), and
        // conflating the two makes the client's handler fragile.
        controller.enqueue(
          new TextEncoder().encode(`event: rejected\ndata: ${JSON.stringify({ reason: rejected })}\n\n`),
        );
        controller.close();
        return;
      }
      connectionId = result.connectionId;
    },
    cancel() {
      unregisterRoomConnection(connectionId);
    },
  });

  request.signal.addEventListener("abort", () => unregisterRoomConnection(connectionId));

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
};
