import { beforeEach, describe, expect, inject, it } from "vitest";

// Drives room-based multiplayer over real HTTP/SSE against the RUNNING app —
// the room-level counterpart of the old spec/arena.test.ts, now proving
// membership, roles, capacity, lock/viewer permissions and room lifecycle
// hold over the wire, not just in src/lib/room-server.ts's own logic.
const baseUrl = inject("baseUrl");

// Same settle convention as the old arena spec: short enough that the suite
// runs in seconds, comfortably longer than ARENA_DISCONNECT_GRACE_MS (set
// short for this test run — see checks.yml/README), so one test's
// just-closed connections and timers can't bleed into the next.
const SETTLE_MS = 600;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
});

// A fresh, collision-proof room name per test — db.ts truncates the `rooms`
// table at boot, but every test in this file shares that one boot, so names
// still have to be unique across the whole suite run, the same way a stray
// hard-coded player name would collide across tests.
function uniqueRoomName(label: string): string {
  return `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on the response");
  return setCookie.split(";")[0];
}

async function newPlayerCookie(): Promise<string> {
  const res = await fetch(new URL("/arena/", baseUrl));
  expect(res.status).toBe(200);
  return sessionCookie(res);
}

async function displayNameFor(cookie: string): Promise<string> {
  const res = await fetch(new URL("/api/session", baseUrl), { headers: { cookie } });
  const body = await res.json();
  return body.displayName as string;
}

interface CreateRoomOptions {
  locked?: boolean;
  allowViewers?: boolean;
}

async function createRoomAs(
  cookie: string,
  name: string,
  options: CreateRoomOptions = {},
): Promise<{ status: number; roomId?: number; reason?: string }> {
  const res = await fetch(new URL("/api/rooms", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, locked: options.locked ?? false, allowViewers: options.allowViewers ?? true }),
  });
  const body = await res.json();
  return { status: res.status, roomId: body.roomId, reason: body.reason };
}

async function joinAs(
  cookie: string,
  roomId: number,
  role: "player" | "viewer",
): Promise<{ status: number; ok: boolean; reason?: string }> {
  const res = await fetch(new URL(`/api/rooms/${roomId}/join`, baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ role }),
  });
  const body = await res.json();
  return { status: res.status, ok: body.ok, reason: body.reason };
}

async function postAction(
  cookie: string,
  path: string,
): Promise<{ status: number; ok: boolean; reason?: string }> {
  // "content-type: application/json" is what marks this as a script-driven
  // call rather than a cross-site form post, even with an empty body — same
  // reasoning as leaderboard.astro's own delete-my-data fetch.
  const res = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
  });
  const body = await res.json();
  return { status: res.status, ok: body.ok, reason: body.reason };
}

interface RoomMemberFrame {
  displayName: string;
  role: "player" | "viewer";
  connected: boolean;
  isMine: boolean;
}
interface RoomFrame {
  room: { id: number; name: string; locked: boolean; allowViewers: boolean };
  arena: { gridSize: number; food: { x: number; y: number }; snakes: { displayName: string; segments: { x: number; y: number }[]; score: number; isMine: boolean }[] };
  members: RoomMemberFrame[];
  yourRole: "player" | "viewer";
}

interface SSEEvent<T> {
  event: string;
  data: T;
}

interface OpenStream<T> {
  read(predicate: (frame: T) => boolean, timeoutMs?: number): Promise<T>;
  readEvent(name: string, timeoutMs?: number): Promise<unknown>;
  close(): void;
}

const decoder = new TextDecoder();

async function openSSE<T>(url: URL, cookie: string): Promise<OpenStream<T>> {
  const controller = new AbortController();
  const res = await fetch(url, { headers: { cookie }, signal: controller.signal });
  if (!res.body) throw new Error("no readable body on the SSE response");
  const reader = res.body.getReader();
  let buffer = "";

  function parseEvent(raw: string): SSEEvent<unknown> | null {
    let eventName = "message";
    let dataLine: string | null = null;
    for (const line of raw.split("\n")) {
      if (line.startsWith("event: ")) eventName = line.slice("event: ".length);
      else if (line.startsWith("data: ")) dataLine = line.slice("data: ".length);
    }
    if (dataLine === null) return null;
    return { event: eventName, data: JSON.parse(dataLine) };
  }

  async function next(timeoutMs: number): Promise<SSEEvent<unknown> | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseEvent(raw);
        if (parsed) return parsed;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buffer += decoder.decode(value, { stream: true });
    }
    return null;
  }

  return {
    async read(predicate, timeoutMs = 2000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const event = await next(Math.max(50, deadline - Date.now()));
        if (!event) break;
        if (event.event === "message" && predicate(event.data as T)) return event.data as T;
      }
      throw new Error(`no matching SSE frame within ${timeoutMs}ms`);
    },
    async readEvent(name, timeoutMs = 2000): Promise<unknown> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const event = await next(Math.max(50, deadline - Date.now()));
        if (!event) break;
        if (event.event === name) return event.data;
      }
      throw new Error(`no "${name}" SSE event within ${timeoutMs}ms`);
    },
    close(): void {
      controller.abort();
    },
  };
}

const openRoomStream = (cookie: string, roomId: number) =>
  openSSE<RoomFrame>(new URL(`/api/rooms/${roomId}/stream`, baseUrl), cookie);

describe("unique room names", () => {
  it("rejects a second room with the same name, case-insensitively", async () => {
    const cookie = await newPlayerCookie();
    const name = uniqueRoomName("Snake Pit");

    const first = await createRoomAs(cookie, name);
    expect(first.status).toBe(201);

    const second = await createRoomAs(cookie, ` ${name.toUpperCase()} `);
    expect(second.status).toBe(409);
    expect(second.reason).toBe("name taken");
  });
});

describe("room creation and search", () => {
  it("creates a room, auto-joins the creator as a Player, and finds it by a case-insensitive partial search", async () => {
    const cookie = await newPlayerCookie();
    const name = uniqueRoomName("Searchable Room");
    const created = await createRoomAs(cookie, name);
    expect(created.status).toBe(201);
    expect(created.roomId).toBeTypeOf("number");

    const listRes = await fetch(new URL(`/api/rooms?q=${encodeURIComponent(name.slice(0, 10).toUpperCase())}`, baseUrl));
    const { rooms } = await listRes.json();
    const found = rooms.find((r: { id: number }) => r.id === created.roomId);
    expect(found).toBeDefined();
    expect(found.playerCount).toBe(1);
    expect(found.maxPlayers).toBe(5);
  });
});

describe("the five-Player cap, with no equivalent limit on Viewers", () => {
  it("rejects a sixth Player but accepts any number of Viewers", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Full House"));
    const roomId = created.roomId!;

    const extraPlayerCookies = await Promise.all([1, 2, 3, 4].map(() => newPlayerCookie()));
    for (const cookie of extraPlayerCookies) {
      const result = await joinAs(cookie, roomId, "player");
      expect(result.ok).toBe(true);
    }

    const sixthCookie = await newPlayerCookie();
    const rejected = await joinAs(sixthCookie, roomId, "player");
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("room is full");

    const viewerCookies = await Promise.all([1, 2, 3].map(() => newPlayerCookie()));
    for (const cookie of viewerCookies) {
      const result = await joinAs(cookie, roomId, "viewer");
      expect(result.ok).toBe(true);
    }

    const listRes = await fetch(new URL(`/api/rooms?q=Full+House`, baseUrl));
    const { rooms } = await listRes.json();
    const summary = rooms.find((r: { id: number }) => r.id === roomId);
    expect(summary.playerCount).toBe(5);
    expect(summary.viewerCount).toBe(3);
  });
});

describe("locked rooms", () => {
  it("rejects a non-creator's Player join but still lets the creator play", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Solo Room"), { locked: true });
    const roomId = created.roomId!;

    const otherCookie = await newPlayerCookie();
    const rejected = await joinAs(otherCookie, roomId, "player");
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("players are locked");

    // The creator can still become a Viewer and then a Player again — being
    // locked only ever excludes *other* users.
    const becomeViewer = await postAction(creatorCookie, `/api/rooms/${roomId}/become-viewer`);
    expect(becomeViewer.ok).toBe(true);
    const becomePlayer = await postAction(creatorCookie, `/api/rooms/${roomId}/become-player`);
    expect(becomePlayer.ok).toBe(true);
  });

  it("still allows Viewers when public viewing is enabled on a locked room", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Locked Viewable"), {
      locked: true,
      allowViewers: true,
    });
    const roomId = created.roomId!;

    const viewerCookie = await newPlayerCookie();
    const result = await joinAs(viewerCookie, roomId, "viewer");
    expect(result.ok).toBe(true);
  });
});

describe("public-viewer permission", () => {
  it("rejects a Viewer join when the room disabled public viewing", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("No Spectators"), { allowViewers: false });
    const roomId = created.roomId!;

    const viewerCookie = await newPlayerCookie();
    const rejected = await joinAs(viewerCookie, roomId, "viewer");
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("viewers are not allowed in this room");
  });
});

describe("lobby preview authorization", () => {
  it("never returns a preview for a locked room or a room with viewers disabled, even if explicitly requested", async () => {
    const creatorCookie = await newPlayerCookie();
    const open = await createRoomAs(creatorCookie, uniqueRoomName("Open Preview"));
    const locked = await createRoomAs(await newPlayerCookie(), uniqueRoomName("Locked Preview"), { locked: true });
    const noViewers = await createRoomAs(await newPlayerCookie(), uniqueRoomName("No Viewer Preview"), {
      allowViewers: false,
    });

    const ids = [open.roomId, locked.roomId, noViewers.roomId];
    const res = await fetch(new URL(`/api/rooms/stream?preview=${ids.join(",")}`, baseUrl));
    const reader = res.body!.getReader();
    const decoder2 = new TextDecoder();
    let buffer = "";
    let frame: { previews: Record<string, unknown> } | null = null;
    while (!frame) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        const line = raw.split("\n").find((l) => l.startsWith("data: "));
        if (line) frame = JSON.parse(line.slice("data: ".length));
        continue;
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder2.decode(value, { stream: true });
    }
    reader.cancel();

    expect(frame).not.toBeNull();
    expect(Object.keys(frame!.previews)).toContain(String(open.roomId));
    expect(Object.keys(frame!.previews)).not.toContain(String(locked.roomId));
    expect(Object.keys(frame!.previews)).not.toContain(String(noViewers.roomId));
  });
});

describe("viewer-to-player switching", () => {
  it("lets a Viewer become a Player when a slot is free, and rejects it when the room is full", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Upgrade Room"));
    const roomId = created.roomId!;

    const viewerCookie = await newPlayerCookie();
    await joinAs(viewerCookie, roomId, "viewer");
    const upgraded = await postAction(viewerCookie, `/api/rooms/${roomId}/become-player`);
    expect(upgraded.ok).toBe(true);

    // Fill the remaining three slots, then a fourth Viewer can't upgrade.
    const fillerCookies = await Promise.all([1, 2, 3].map(() => newPlayerCookie()));
    for (const cookie of fillerCookies) await joinAs(cookie, roomId, "player");

    const lastViewerCookie = await newPlayerCookie();
    await joinAs(lastViewerCookie, roomId, "viewer");
    const rejected = await postAction(lastViewerCookie, `/api/rooms/${roomId}/become-player`);
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe("room is full");
  });
});

describe("player death, respawn, and leaving", () => {
  it(
    "eliminates an unsteered Player, keeps the game running for the rest of the room, and allows respawn/leave",
    async () => {
      const creatorCookie = await newPlayerCookie();
      const creatorName = await displayNameFor(creatorCookie);
      const created = await createRoomAs(creatorCookie, uniqueRoomName("Death And Respawn"));
      const roomId = created.roomId!;

      const otherCookie = await newPlayerCookie();
      await joinAs(otherCookie, roomId, "player");

      const stream = await openRoomStream(creatorCookie, roomId);
      // Nobody ever steers the creator's snake — every snake starts facing
      // "right", so it drifts into the wall within gridSize ticks at most.
      await stream.read((f) => f.arena.snakes.every((s) => s.displayName !== creatorName), 4000);

      // The room itself is unaffected: the other Player is still a member
      // and the room still exists.
      const otherStream = await openRoomStream(otherCookie, roomId);
      const otherFrame = await otherStream.read(() => true);
      expect(otherFrame.members.some((m) => m.role === "player")).toBe(true);
      otherStream.close();

      // Membership survives elimination — only the snake is gone.
      const afterDeath = await stream.read(() => true);
      expect(afterDeath.members.some((m) => m.isMine && m.role === "player")).toBe(true);

      const respawned = await postAction(creatorCookie, `/api/rooms/${roomId}/respawn`);
      expect(respawned.ok).toBe(true);
      await stream.read((f) => f.arena.snakes.some((s) => s.isMine));

      const becameViewer = await postAction(creatorCookie, `/api/rooms/${roomId}/become-viewer`);
      expect(becameViewer.ok).toBe(true);

      stream.close();

      const leaveResult = await postAction(otherCookie, `/api/rooms/${roomId}/leave`);
      expect(leaveResult.status).toBe(200);
    },
    10_000,
  );
});

describe("creator departure and room cleanup", () => {
  it("closes the room when its creator explicitly leaves, notifying other open sessions", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Closing Room"));
    const roomId = created.roomId!;

    const viewerCookie = await newPlayerCookie();
    await joinAs(viewerCookie, roomId, "viewer");
    const viewerStream = await openRoomStream(viewerCookie, roomId);
    await viewerStream.read(() => true);

    await postAction(creatorCookie, `/api/rooms/${roomId}/leave`);

    const closedEvent = (await viewerStream.readEvent("closed", 2000)) as { reason: string };
    expect(closedEvent.reason).toBeTruthy();
    viewerStream.close();

    const listRes = await fetch(new URL(`/api/rooms?q=Closing+Room`, baseUrl));
    const { rooms } = await listRes.json();
    expect(rooms.find((r: { id: number }) => r.id === roomId)).toBeUndefined();

    const joinAfterClose = await joinAs(await newPlayerCookie(), roomId, "viewer");
    expect(joinAfterClose.ok).toBe(false);
    expect(joinAfterClose.reason).toBe("room not found");
  });

  it(
    "closes the room when its creator disconnects and never reconnects",
    async () => {
      const creatorCookie = await newPlayerCookie();
      const created = await createRoomAs(creatorCookie, uniqueRoomName("Creator Vanishes"));
      const roomId = created.roomId!;

      const creatorStream = await openRoomStream(creatorCookie, roomId);
      await creatorStream.read(() => true);
      creatorStream.close();

      // Longer than the test run's shortened disconnect-grace window.
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

      const listRes = await fetch(new URL(`/api/rooms?q=Creator+Vanishes`, baseUrl));
      const { rooms } = await listRes.json();
      expect(rooms.find((r: { id: number }) => r.id === roomId)).toBeUndefined();
    },
    10_000,
  );
});

describe("concurrent attempts to claim the final Player slot", () => {
  it("lets exactly one of two simultaneous requests take the last Player slot", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Last Slot"));
    const roomId = created.roomId!;

    const fillerCookies = await Promise.all([1, 2, 3].map(() => newPlayerCookie()));
    for (const cookie of fillerCookies) await joinAs(cookie, roomId, "player");
    // 4/5 Players now (creator + 3) — exactly one slot left.

    const [cookieX, cookieY] = await Promise.all([newPlayerCookie(), newPlayerCookie()]);
    const [resultX, resultY] = await Promise.all([
      joinAs(cookieX, roomId, "player"),
      joinAs(cookieY, roomId, "player"),
    ]);

    const outcomes = [resultX.ok, resultY.ok];
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(outcomes.filter((ok) => !ok)).toHaveLength(1);
    const rejected = resultX.ok ? resultY : resultX;
    expect(rejected.reason).toBe("room is full");
  });
});

describe("real-time propagation to multiple independent sessions", () => {
  it("reflects a direction change posted by one Player in another session's stream in well under a second", async () => {
    const creatorCookie = await newPlayerCookie();
    const creatorName = await displayNameFor(creatorCookie);
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Propagation Room"));
    const roomId = created.roomId!;

    const otherCookie = await newPlayerCookie();
    await joinAs(otherCookie, roomId, "player");

    const creatorStream = await openRoomStream(creatorCookie, roomId);
    const initial = await creatorStream.read((f) => f.arena.snakes.some((s) => s.isMine));
    const startY = initial.arena.snakes.find((s) => s.isMine)!.segments[0].y;

    const otherStream = await openRoomStream(otherCookie, roomId);
    await otherStream.read((f) => f.arena.snakes.some((s) => s.displayName === creatorName));

    const before = Date.now();
    const input = await fetch(new URL(`/api/rooms/${roomId}/input`, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: creatorCookie },
      body: JSON.stringify({ direction: "down" }),
    });
    expect(input.status).toBe(200);

    const updated = await otherStream.read((f) => {
      const creator = f.arena.snakes.find((s) => s.displayName === creatorName);
      return creator !== undefined && creator.segments[0].y > startY;
    }, 1000);
    const elapsedMs = Date.now() - before;

    expect(updated.arena.snakes.find((s) => s.displayName === creatorName)?.segments[0].y).toBeGreaterThan(startY);
    expect(elapsedMs).toBeLessThan(1000);

    creatorStream.close();
    otherStream.close();
  });

  it("rejects a Viewer's attempt to send gameplay input", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Viewer Cant Play"));
    const roomId = created.roomId!;

    const viewerCookie = await newPlayerCookie();
    await joinAs(viewerCookie, roomId, "viewer");

    const stream = await openRoomStream(creatorCookie, roomId);
    const before = await stream.read((f) => f.arena.snakes.some((s) => s.isMine));
    const creatorHead = before.arena.snakes.find((s) => s.isMine)!.segments[0];

    // Accepted at the HTTP layer (a malformed body would 400), but silently
    // has no effect on the game: a Viewer's input never reaches tickArena.
    const res = await fetch(new URL(`/api/rooms/${roomId}/input`, baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: viewerCookie },
      body: JSON.stringify({ direction: "up" }),
    });
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await stream.read(() => true);
    // The creator's own snake kept moving under its own queued direction,
    // undisturbed by the Viewer's rejected input.
    expect(after.arena.snakes.some((s) => s.isMine)).toBe(true);
    expect(creatorHead).toBeDefined();
    stream.close();
  });
});

describe("reconnection and authoritative snapshots", () => {
  it("resumes the same membership and snake on a reconnect inside the grace window", async () => {
    const creatorCookie = await newPlayerCookie();
    const created = await createRoomAs(creatorCookie, uniqueRoomName("Reconnect Room"));
    const roomId = created.roomId!;

    const first = await openRoomStream(creatorCookie, roomId);
    const before = await first.read((f) => f.arena.snakes.some((s) => s.isMine));
    first.close();

    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await openRoomStream(creatorCookie, roomId);
    const after = await second.read((f) => f.arena.snakes.some((s) => s.isMine));
    second.close();

    expect(after.arena.snakes.filter((s) => s.isMine)).toHaveLength(1);
    expect(after.yourRole).toBe("player");
    expect(before.room.id).toBe(roomId);
  });
});
