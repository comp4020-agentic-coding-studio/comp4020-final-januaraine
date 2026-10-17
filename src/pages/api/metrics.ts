import type { APIRoute } from "astro";
import { getCounters } from "../../lib/observability";
import { activeRoomCount, totalActiveConnectionCount, totalActivePlayerCount } from "../../lib/room-server";

// C10's runtime-counters endpoint: everything Phase 7 asks to answer
// ("who's connected, which room, is a game running") in one cheap read, no
// auth — same posture as /api/health, nothing here is secret. Gauges
// (activeConnections/activeRooms/activePlayers) are computed live from the
// in-memory room registry; the rest are counters accumulated since this
// process started (see lib/observability.ts — reset on restart, same as
// every other in-memory piece of room state).
export const GET: APIRoute = () => {
  const body = {
    activeConnections: totalActiveConnectionCount(),
    activeRooms: activeRoomCount(),
    activePlayers: totalActivePlayerCount(),
    ...getCounters(),
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
};
