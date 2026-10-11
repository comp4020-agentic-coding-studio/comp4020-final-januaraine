import type { APIRoute } from "astro";
import { listRooms } from "../../../lib/db";
import { createRoomAndJoinCreator, getRoomSummary, type RoomSummary } from "../../../lib/room-server";
import { getOrCreatePlayer } from "../../../lib/session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const PAGE_SIZE = 20;

// The lobby's paginated, searchable listing — cheap (DB columns only, no
// live state) by design, since this is also what a page-change or search
// re-fetches synchronously before the SSE stream (stream.ts) takes over for
// live updates. Rooms with no matching live runtime (e.g. closed between the
// DB read and this response) are dropped rather than shown as a dead card.
export const GET: APIRoute = ({ url, cookies }) => {
  const search = url.searchParams.get("q")?.trim().slice(0, 40) || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const player = getOrCreatePlayer(cookies);

  const rows = listRooms({ search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const rooms: RoomSummary[] = rows
    .map((row) => getRoomSummary(row.id, player.id))
    .filter((summary): summary is RoomSummary => summary !== null);

  return jsonResponse(200, { rooms, page, pageSize: PAGE_SIZE });
};

interface CreateRoomBody {
  name?: unknown;
  locked?: unknown;
  allowViewers?: unknown;
}

// Creates a room and joins the caller as its Player automatically (see
// createRoomAndJoinCreator) — room name uniqueness is enforced by the
// database's own unique index (db.ts's createRoom), not a prior read, so two
// concurrent requests for the same name can't both succeed.
export const POST: APIRoute = async ({ request, cookies }) => {
  let body: CreateRoomBody;
  try {
    body = (await request.json()) as CreateRoomBody;
  } catch {
    return jsonResponse(400, { ok: false, reason: "body must be JSON" });
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonResponse(400, { ok: false, reason: "room name is required" });
  }
  const locked = body.locked === true;
  const allowViewers = body.allowViewers !== false;

  const player = getOrCreatePlayer(cookies);
  const result = createRoomAndJoinCreator({
    name: body.name,
    creatorPlayerId: player.id,
    creatorDisplayName: player.displayName,
    locked,
    allowViewers,
  });

  if (!result.ok) {
    const status = result.reason === "name taken" ? 409 : 400;
    return jsonResponse(status, { ok: false, reason: result.reason });
  }

  return jsonResponse(201, { ok: true, roomId: result.roomId });
};
