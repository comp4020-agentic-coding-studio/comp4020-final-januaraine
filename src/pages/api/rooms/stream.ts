import type { APIRoute } from "astro";
import { listRooms } from "../../../lib/db";
import { getRoomPreview, getRoomSummary, type RoomSummary } from "../../../lib/room-server";
import { getOrCreatePlayer } from "../../../lib/session";

const PAGE_SIZE = 20;
// Independent of any room's own 120ms game tick (game/config.ts's TICK_MS) —
// the lobby only needs to look "live," not frame-accurate, and a slower,
// fixed cadence here is what keeps cost bounded regardless of how many rooms
// exist or how many are being previewed at once.
const LOBBY_PUSH_MS = 400;

// The lobby's live feed: room cards (name, counts, locked/allowViewers) for
// the current search+page, plus a miniature preview for every one of *those
// same* room ids — recomputed from `rows` fresh on every push, not from a
// client-supplied id list captured once at connection-open time. That's
// deliberate: a room created after this connection already opened still
// shows up in the next `rows` fetch (the query itself re-runs every tick),
// so deriving previews from `rows` right here means a brand-new room's
// preview appears on this same, still-open connection the very next push —
// no second request, no reopened EventSource, nothing to go stale. The
// earlier design instead took a one-time `preview=<ids>` query param from the
// client and held onto it for the life of the connection, which meant a room
// created after the page loaded could appear in the room list but never get
// a preview until the client reopened the stream (e.g. a full reload).
// Authorization is still enforced in room-server.ts's getRoomPreview, not
// here — a locked or viewer-disabled room's id simply never gets a preview
// back, whatever the UI happens to hide.
export const GET: APIRoute = ({ url, cookies }) => {
  const search = url.searchParams.get("q")?.trim().slice(0, 40) || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const player = getOrCreatePlayer(cookies);

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (): void => {
        const rows = listRooms({ search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
        const rooms: RoomSummary[] = rows
          .map((row) => getRoomSummary(row.id, player.id))
          .filter((summary): summary is RoomSummary => summary !== null);

        const previews: Record<number, ReturnType<typeof getRoomPreview>> = {};
        for (const row of rows) {
          const preview = getRoomPreview(row.id);
          if (preview) previews[row.id] = preview;
        }

        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ rooms, previews })}\n\n`));
        } catch {
          if (timer) clearInterval(timer);
        }
      };

      push();
      timer = setInterval(push, LOBBY_PUSH_MS);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
};
