import { describe, expect, inject, it } from "vitest";

// Drives /api/metrics (C10) over real HTTP against the RUNNING app, the same
// pattern as spec/games.test.ts and spec/rooms.test.ts. Keeps it light: this
// proves the endpoint's shape and that the gauges actually move when the
// live room registry changes, not exhaustive coverage of every event type —
// src/lib/room-server.ts's per-event logging is exercised indirectly by
// every other spec/*.test.ts that already drives rooms over HTTP.
const baseUrl = inject("baseUrl");

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on the response");
  return setCookie.split(";")[0];
}

function uniqueRoomName(label: string): string {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function newPlayerCookie(): Promise<string> {
  const res = await fetch(new URL("/arena/", baseUrl));
  expect(res.status).toBe(200);
  return sessionCookie(res);
}

interface Metrics {
  activeConnections: number;
  activeRooms: number;
  activePlayers: number;
  gamesStarted: number;
  gamesFinished: number;
  foodCollected: number;
  playerEliminations: number;
  sseDisconnects: number;
  sseErrors: number;
  databaseErrors: number;
}

async function fetchMetrics(): Promise<Metrics> {
  const res = await fetch(new URL("/api/metrics", baseUrl));
  expect(res.status).toBe(200);
  return (await res.json()) as Metrics;
}

const NUMERIC_KEYS: (keyof Metrics)[] = [
  "activeConnections",
  "activeRooms",
  "activePlayers",
  "gamesStarted",
  "gamesFinished",
  "foodCollected",
  "playerEliminations",
  "sseDisconnects",
  "sseErrors",
  "databaseErrors",
];

describe("/api/metrics", () => {
  it("answers with every expected counter as a number", async () => {
    const metrics = await fetchMetrics();
    for (const key of NUMERIC_KEYS) {
      expect(typeof metrics[key], `${key} should be a number`).toBe("number");
    }
  });

  it("reflects a newly created room and its creator in the live gauges", async () => {
    const before = await fetchMetrics();

    const cookie = await newPlayerCookie();
    const createRes = await fetch(new URL("/api/rooms", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: uniqueRoomName("Metrics Room"), locked: false, allowViewers: true }),
    });
    expect(createRes.status).toBe(201);

    const after = await fetchMetrics();
    expect(after.activeRooms).toBe(before.activeRooms + 1);
    expect(after.activePlayers).toBe(before.activePlayers + 1);
    expect(after.gamesStarted).toBeGreaterThan(before.gamesStarted);
  });

  it("drops the room from activeRooms/activePlayers once its only Player leaves", async () => {
    const cookie = await newPlayerCookie();
    const createRes = await fetch(new URL("/api/rooms", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: uniqueRoomName("Metrics Leave Room"), locked: false, allowViewers: true }),
    });
    expect(createRes.status).toBe(201);
    const { roomId } = (await createRes.json()) as { roomId: number };

    const before = await fetchMetrics();

    const leaveRes = await fetch(new URL(`/api/rooms/${roomId}/leave`, baseUrl), {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
    });
    expect(leaveRes.status).toBe(200);

    const after = await fetchMetrics();
    expect(after.activeRooms).toBe(before.activeRooms - 1);
    expect(after.activePlayers).toBe(before.activePlayers - 1);
  });
});
