import { describe, expect, inject, it } from "vitest";

// Drives the backend over HTTP against the RUNNING app, same as
// games.test.ts — this proves the per-player dedupe, deletion and
// search/filter behaviour hold for the deployed contract, not just for
// whichever function happened to be called directly.
const baseUrl = inject("baseUrl");

interface LeaderboardEntry {
  gameId: number;
  displayName: string;
  score: number;
  survivalTimeMs: number;
  finishedAt: string;
  isMine: boolean;
}

function sessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("no Set-Cookie header on the response");
  return setCookie.split(";")[0];
}

async function newPlayerCookie(): Promise<string> {
  const res = await fetch(new URL("/play/", baseUrl));
  expect(res.status).toBe(200);
  return sessionCookie(res);
}

async function displayNameFor(cookie: string): Promise<string> {
  const res = await fetch(new URL("/api/session", baseUrl), { headers: { cookie } });
  const body = await res.json();
  return body.displayName as string;
}

async function submitGame(cookie: string, score: number, ticks: number): Promise<{ id: number }> {
  const res = await fetch(new URL("/api/games", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ score, ticks }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.game;
}

async function fetchLeaderboard(query = ""): Promise<{ status: number; entries: LeaderboardEntry[]; errors?: string[] }> {
  const res = await fetch(new URL(`/api/leaderboard${query}`, baseUrl));
  const body = await res.json();
  return { status: res.status, entries: body.entries ?? [], errors: body.errors };
}

// A same-origin DELETE with no body still needs a non-form content type: a
// browser's own fetch() always sends one, and this mirrors that rather than
// relying on Astro's CSRF check treating a bare DELETE as a cross-site form
// post (see src/pages/leaderboard.astro's own fetch call).
async function deleteMyEntry(cookie?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return fetch(new URL("/api/leaderboard/me", baseUrl), {
    method: "DELETE",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("per-player leaderboard ranking", () => {
  it("collapses one player's multiple runs into a single entry at their best score", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);

    for (const score of [20, 40, 60]) {
      await submitGame(cookie, score, 10);
    }

    const { entries } = await fetchLeaderboard(`?player=${encodeURIComponent(name)}`);
    expect(entries).toHaveLength(1);
    expect(entries[0].score).toBe(60);
    expect(entries[0].displayName).toBe(name);
  });

  it("ranks distinct players by their own personal best, never by a lower run", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    for (const score of [80, 60, 40]) await submitGame(cookieA, score, 10);

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    for (const score of [70, 50]) await submitGame(cookieB, score, 10);

    // Narrow enough that neither player's lower runs (40, 50) can appear.
    const { entries } = await fetchLeaderboard("?minScore=70&maxScore=80");
    expect(entries.filter((e) => e.displayName === nameA)).toHaveLength(1);
    expect(entries.filter((e) => e.displayName === nameB)).toHaveLength(1);

    const mineA = entries.find((e) => e.displayName === nameA)!;
    const mineB = entries.find((e) => e.displayName === nameB)!;
    expect(mineA.score).toBe(80);
    expect(mineB.score).toBe(70);
    expect(entries.indexOf(mineA)).toBeLessThan(entries.indexOf(mineB));
  });

  it("reports the survived/finished time of the run that produced the best score, not any other run", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);

    await submitGame(cookie, 10, 1); // 120ms survival, not the best score
    const best = await submitGame(cookie, 90, 9); // 1080ms survival, the best score

    const { entries } = await fetchLeaderboard(`?player=${encodeURIComponent(name)}`);
    expect(entries).toHaveLength(1);
    expect(entries[0].score).toBe(90);
    expect(entries[0].gameId).toBe(best.id);
    expect(entries[0].survivalTimeMs).toBe(9 * 120);
  });

  it("breaks a tie between equal best scores deterministically, by whoever finished first", async () => {
    const cookie1 = await newPlayerCookie();
    const name1 = await displayNameFor(cookie1);
    await submitGame(cookie1, 30, 10);

    const cookie2 = await newPlayerCookie();
    const name2 = await displayNameFor(cookie2);
    await submitGame(cookie2, 30, 10);

    const first = await fetchLeaderboard("?minScore=30&maxScore=30");
    const i1 = first.entries.findIndex((e) => e.displayName === name1);
    const i2 = first.entries.findIndex((e) => e.displayName === name2);
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThanOrEqual(0);
    expect(i1).toBeLessThan(i2);

    const again = await fetchLeaderboard("?minScore=30&maxScore=30");
    expect(again.entries).toEqual(first.entries);
  });
});

describe("leaderboard search/filter", () => {
  it("matches a player by a case-insensitive partial name", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie); // "Player XXXX"
    await submitGame(cookie, 10, 1);

    const needle = name.slice(-3).toLowerCase(); // last 3 of the hex suffix
    const { entries } = await fetchLeaderboard(`?player=${encodeURIComponent(needle)}`);
    expect(entries.some((e) => e.displayName === name)).toBe(true);
  });

  it("filters by an exact score", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 120, 12);

    const { entries } = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&score=120`);
    expect(entries).toHaveLength(1);
    expect(entries[0].score).toBe(120);
  });

  it("filters by a date range, excluding a from-date in the future", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 10, 1);

    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const empty = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&from=${future}`);
    expect(empty.entries).toHaveLength(0);

    const found = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&from=2000-01-01&to=${future}`);
    expect(found.entries.some((e) => e.displayName === name)).toBe(true);
  });

  it("combines player, score and date filters together", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 50, 5);

    const today = new Date().toISOString().slice(0, 10);
    const { entries } = await fetchLeaderboard(
      `?player=${encodeURIComponent(name)}&minScore=50&maxScore=50&from=${today}&to=${today}`,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName).toBe(name);
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    const { status, entries } = await fetchLeaderboard("?player=__definitely-not-a-real-player__");
    expect(status).toBe(200);
    expect(entries).toEqual([]);
  });

  it("rejects malformed filters with 400", async () => {
    const badScore = await fetchLeaderboard("?minScore=not-a-number");
    expect(badScore.status).toBe(400);
    expect(badScore.errors?.length).toBeGreaterThan(0);

    const badDate = await fetchLeaderboard("?from=not-a-date");
    expect(badDate.status).toBe(400);

    const badRange = await fetchLeaderboard("?minScore=50&maxScore=10");
    expect(badRange.status).toBe(400);
  });
});

describe("removing a leaderboard entry", () => {
  it("lets a player remove their own entry without affecting another player's", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    await submitGame(cookieA, 10, 1);

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    await submitGame(cookieB, 10, 1);

    const del = await deleteMyEntry(cookieA);
    expect(del.status).toBe(200);
    const delBody = await del.json();
    expect(delBody.ok).toBe(true);

    const after = await fetchLeaderboard(`?player=${encodeURIComponent(nameA)}`);
    expect(after.entries).toHaveLength(0);

    const stillThere = await fetchLeaderboard(`?player=${encodeURIComponent(nameB)}`);
    expect(stillThere.entries.some((e) => e.displayName === nameB)).toBe(true);
  });

  it("ignores a client-supplied id and only ever deletes the caller's own entry", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    await submitGame(cookieA, 10, 1);

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    await submitGame(cookieB, 10, 1);

    // Attacker-shaped request: A's own cookie, but a body trying to name B.
    const del = await deleteMyEntry(cookieA, { playerId: 999999, displayName: nameB });
    expect(del.status).toBe(200);

    const bGone = await fetchLeaderboard(`?player=${encodeURIComponent(nameB)}`);
    expect(bGone.entries.some((e) => e.displayName === nameB)).toBe(true); // B untouched

    const aGone = await fetchLeaderboard(`?player=${encodeURIComponent(nameA)}`);
    expect(aGone.entries).toHaveLength(0); // only the caller's own entry went away
  });

  it("rejects a delete with no session", async () => {
    const res = await deleteMyEntry();
    expect(res.status).toBe(404);
  });

  it("brings a player back onto the leaderboard once they submit a new result", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 10, 1);

    await deleteMyEntry(cookie);
    const hidden = await fetchLeaderboard(`?player=${encodeURIComponent(name)}`);
    expect(hidden.entries).toHaveLength(0);

    await submitGame(cookie, 20, 2);
    const visible = await fetchLeaderboard(`?player=${encodeURIComponent(name)}`);
    expect(visible.entries).toHaveLength(1);
    expect(visible.entries[0].score).toBe(20);
  });
});

describe("the leaderboard page", () => {
  it("renders the per-player wording, search controls, and a visitor's own remove action", async () => {
    const cookie = await newPlayerCookie();
    // High enough to sit near the top regardless of other test data, so the
    // row — and its Remove button — is actually on the first page.
    await submitGame(cookie, 9990, 999);

    const res = await fetch(new URL("/leaderboard/", baseUrl), { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ranked by personal best score");
    expect(html).toMatch(/name="player"/);
    expect(html).toMatch(/name="minScore"/);
    expect(html).toMatch(/name="maxScore"/);
    expect(html).toContain('data-action="remove-me"');
  });

  it("shows the no-results message for a search with no matches", async () => {
    const res = await fetch(new URL("/leaderboard/?player=__definitely-not-a-real-player__", baseUrl));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No players match your search.");
  });
});
