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

function parsePreviewIds(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
}

// The lobby's live feed: room cards (name, counts, locked/allowViewers) for
// the current search+page, plus a miniature preview for whichever room ids
// the client says are currently visible on screen (`preview`, a page's worth
// at most — the client reopens this connection, a fresh EventSource, whenever
// the visible set changes, since that's only meaningful at connection-open
// time). Authorization for previews is enforced in room-server.ts's
// getRoomPreview, not here — requesting a locked or viewer-disabled room's id
// simply never gets a preview back, whatever the UI happens to hide.
export const GET: APIRoute = ({ url, cookies }) => {
  const search = url.searchParams.get("q")?.trim().slice(0, 40) || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const previewIds = parsePreviewIds(url.searchParams.get("preview"));
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
        for (const id of previewIds) {
          const preview = getRoomPreview(id);
          if (preview) previews[id] = preview;
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
