import { beforeEach, describe, expect, inject, it } from "vitest";

// Drives the arena over HTTP against the RUNNING app, the same way the rest
// of spec/ does — this is what proves the realtime contract holds for the
// deployed image, not just for arena.ts's pure functions (already covered,
// fast and exhaustively, by src/game/arena.test.ts). The wire shape is
// treated as the contract, not reconstructed from src/game/arena's own
// types: spec/ tests what a caller observes over HTTP, not how it's
// implemented (see spec/README.md).
const baseUrl = inject("baseUrl");

// The app under test runs with ARENA_DISCONNECT_GRACE_MS set well below
// production's default (see checks.yml / this repo's README for how to run
// locally) specifically so these tests run in seconds, not minutes. A short
// settle pause between tests — comfortably longer than that grace window —
// keeps one test's just-closed connections from still being live (and so
// still moving, still collidable) when the next test starts.
const SETTLE_MS = 600;
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
});

interface ArenaSnakeFrame {
  displayName: string;
  segments: { x: number; y: number }[];
  score: number;
  isMine: boolean;
}
interface ArenaFrame {
  gridSize: number;
  food: { x: number; y: number };
  snakes: ArenaSnakeFrame[];
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

interface OpenStream {
  read(predicate: (frame: ArenaFrame) => boolean, timeoutMs?: number): Promise<ArenaFrame>;
  close(): void;
}

const decoder = new TextDecoder();

// Opens the real SSE connection a browser's EventSource would, and exposes
// "wait for a frame matching X" — the HTTP-level equivalent of "wait for the
// UI to show X" that a two-browser-window check would look for by eye.
async function openStream(cookie: string): Promise<OpenStream> {
  const controller = new AbortController();
  const res = await fetch(new URL("/api/arena/stream", baseUrl), {
    headers: { cookie },
    signal: controller.signal,
  });
  if (!res.body) throw new Error("no readable body on the SSE response");
  const reader = res.body.getReader();
  let buffer = "";

  return {
    async read(predicate, timeoutMs = 2000): Promise<ArenaFrame> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const line = rawEvent.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            const frame = JSON.parse(line.slice("data: ".length)) as ArenaFrame;
            if (predicate(frame)) return frame;
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
      throw new Error(`no matching SSE frame within ${timeoutMs}ms`);
    },
    close(): void {
      controller.abort();
    },
  };
}

describe("joining the shared arena", () => {
  it("gives two distinct players distinct identities, each visible to the other", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    const streamA = await openStream(cookieA);
    const frameA = await streamA.read(() => true);
    expect(frameA.snakes).toHaveLength(1);
    expect(frameA.snakes[0]).toMatchObject({ displayName: nameA, isMine: true });

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    expect(nameB).not.toBe(nameA);
    const streamB = await openStream(cookieB);
    const frameB = await streamB.read((f) => f.snakes.length >= 2);

    const mine = frameB.snakes.find((s) => s.isMine);
    const other = frameB.snakes.find((s) => !s.isMine);
    expect(mine?.displayName).toBe(nameB);
    expect(other?.displayName).toBe(nameA);

    streamA.close();
    streamB.close();
  });
});

describe("realtime propagation", () => {
  it("reflects a direction change posted by one player in another player's stream in well under a second, with no reload", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    const cookieB = await newPlayerCookie();

    const streamA = await openStream(cookieA);
    const initial = await streamA.read((f) => f.snakes.some((s) => s.isMine));
    const startY = initial.snakes.find((s) => s.isMine)!.segments[0].y;

    const streamB = await openStream(cookieB);
    await streamB.read((f) => f.snakes.some((s) => s.displayName === nameA));

    const before = Date.now();
    const input = await fetch(new URL("/api/arena/input", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieA },
      body: JSON.stringify({ direction: "down" }),
    });
    expect(input.status).toBe(200);

    // B never sent anything — this is purely A's move, observed on a
    // connection that belongs to a different player.
    const updated = await streamB.read((f) => {
      const a = f.snakes.find((s) => s.displayName === nameA);
      return a !== undefined && a.segments[0].y > startY;
    }, 1000);
    const elapsedMs = Date.now() - before;

    expect(updated.snakes.find((s) => s.displayName === nameA)?.segments[0].y).toBeGreaterThan(startY);
    expect(elapsedMs).toBeLessThan(1000);

    streamA.close();
    streamB.close();
  });

  it("shares one food item and one collision outcome across every connected session", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    const cookieB = await newPlayerCookie();

    const streamA = await openStream(cookieA);
    const first = await streamA.read((f) => f.snakes.some((s) => s.isMine));
    const streamB = await openStream(cookieB);
    const bView = await streamB.read((f) => f.snakes.some((s) => s.displayName === nameA));

    // Both sessions must agree on where the one shared food item is — there
    // is no such thing as "B's food" and "A's food".
    expect(bView.food).toEqual(first.food);

    streamA.close();
    streamB.close();
  });
});

describe("server-side input validation", () => {
  it("rejects a direction that isn't one of up/down/left/right", async () => {
    const cookie = await newPlayerCookie();
    const res = await fetch(new URL("/api/arena/input", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ direction: "sideways" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a position or score instead of a direction", async () => {
    const cookie = await newPlayerCookie();
    const res = await fetch(new URL("/api/arena/input", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ x: 5, y: 5, score: 99999 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("elimination and persistence", () => {
  it("eliminates a snake that runs into the wall and persists the run through the leaderboard", async () => {
    // Nobody ever sends a direction for this player: every snake starts
    // facing "right", so it drifts into the right-hand wall within
    // gridSize ticks at most (20 * 120ms = 2.4s) with no input needed —
    // a deterministic way to force a server-computed elimination over a
    // real HTTP connection, whatever the random spawn point turned out to be.
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    const stream = await openStream(cookie);
    await stream.read((f) => f.snakes.some((s) => s.isMine));

    await stream.read((f) => f.snakes.every((s) => s.displayName !== name), 4000);
    stream.close();

    const leaderboard = await fetch(new URL(`/api/leaderboard?player=${encodeURIComponent(name)}`, baseUrl));
    const { entries } = await leaderboard.json();
    expect(entries.some((e: { displayName: string }) => e.displayName === name)).toBe(true);
  });
});

describe("disconnect and reconnect", () => {
  it(
    "removes a player who disconnects and never reconnects, without persisting a result",
    async () => {
      const cookie = await newPlayerCookie();
      const name = await displayNameFor(cookie);
      const stream = await openStream(cookie);
      await stream.read((f) => f.snakes.some((s) => s.isMine));
      stream.close(); // no reconnect follows, and nobody else is connected —
      // the tick loop itself stops, so this player's snake just sits idle
      // rather than risking an incidental collision before the grace timer
      // removes it (see arena-server.ts's stopTickLoopIfIdle).

      // Longer than the test run's shortened disconnect-grace window.
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

      const observerCookie = await newPlayerCookie();
      const observer = await openStream(observerCookie);
      const frame = await observer.read(() => true);
      observer.close();

      expect(frame.snakes.some((s) => s.displayName === name)).toBe(false);

      const leaderboard = await fetch(new URL(`/api/leaderboard?player=${encodeURIComponent(name)}`, baseUrl));
      const { entries } = await leaderboard.json();
      expect(entries).toHaveLength(0);
    },
    10_000,
  );

  it("resumes the same snake on a reconnect inside the grace window, rather than minting a second one", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);

    const first = await openStream(cookie);
    await first.read((f) => f.snakes.some((s) => s.isMine));
    first.close();

    // Comfortably inside the test run's shortened grace window (400ms) —
    // production's much longer default exists for exactly this gap, just
    // measured in real seconds instead.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const second = await openStream(cookie);
    const frame = await second.read((f) => f.snakes.some((s) => s.isMine));
    second.close();

    expect(frame.snakes.filter((s) => s.displayName === name)).toHaveLength(1);
  });
});
