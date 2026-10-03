import type { APIRoute } from "astro";
import { db } from "../../lib/db";
import { players } from "../../lib/schema";

// Confirms the server is up *and* the database is actually reachable, not
// just that the process is alive — the distinction a plain 200 from `/`
// wouldn't make. Cheap enough to hit from Fly's own health checks later, and
// a natural first thing C10 instruments.
export const GET: APIRoute = () => {
  try {
    db.select().from(players).limit(1).all();
    return new Response(JSON.stringify({ status: "ok" }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return new Response(JSON.stringify({ status: "error", message }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
};
