import { describe, expect, inject, it } from "vitest";

// Drives the backend over HTTP against the RUNNING app, same as
// games.test.ts — this proves the per-player dedupe, sorting, permanent
// deletion and search/filter behaviour hold for the deployed contract, not
// just for whichever function happened to be called directly.
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

async function fetchLeaderboard(
  query = "",
): Promise<{ status: number; entries: LeaderboardEntry[]; errors?: string[] }> {
  const res = await fetch(new URL(`/api/leaderboard${query}`, baseUrl));
  const body = await res.json();
  return { status: res.status, entries: body.entries ?? [], errors: body.errors };
}

// A same-origin DELETE with no body still needs a non-form content type: a
// browser's own fetch() always sends one, and this mirrors that rather than
// relying on Astro's CSRF check treating a bare DELETE as a cross-site form
// post (see src/pages/leaderboard.astro's own fetch call).
async function deleteMe(cookie?: string, body?: unknown): Promise<Response> {
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

  it("selects each distinct player's own personal best, never a lower run", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    for (const score of [80, 60, 40]) await submitGame(cookieA, score, 10);

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    for (const score of [70, 50]) await submitGame(cookieB, score, 10);

    const a = await fetchLeaderboard(`?player=${encodeURIComponent(nameA)}`);
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0].score).toBe(80);

    const b = await fetchLeaderboard(`?player=${encodeURIComponent(nameB)}`);
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0].score).toBe(70);
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

  it("breaks a tie between equal best scores deterministically, and stays stable across requests", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 30, 10);

    const first = await fetchLeaderboard(`?player=${encodeURIComponent(name)}`);
    const again = await fetchLeaderboard(`?player=${encodeURIComponent(name)}`);
    expect(again.entries).toEqual(first.entries);
  });

  it("never shows the same player twice, in either sort order (Top N is distinct players)", async () => {
    const cookie = await newPlayerCookie();
    for (const score of [10, 20, 30]) await submitGame(cookie, score, 10);

    for (const sort of ["desc", "asc"]) {
      const { entries } = await fetchLeaderboard(`?sort=${sort}`);
      const names = entries.map((e) => e.displayName);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

describe("score sorting", () => {
  it("defaults to highest score first", async () => {
    const { entries } = await fetchLeaderboard("");
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].score).toBeGreaterThanOrEqual(entries[i].score);
    }
  });

  it("sort=desc is non-increasing and sort=asc is non-decreasing across the whole result", async () => {
    const cookieA = await newPlayerCookie();
    await submitGame(cookieA, 29000, 2900); // far above anything else this suite creates
    const cookieB = await newPlayerCookie();
    await submitGame(cookieB, 0, 1); // as low as a valid score gets

    const desc = await fetchLeaderboard("?sort=desc");
    for (let i = 1; i < desc.entries.length; i++) {
      expect(desc.entries[i - 1].score).toBeGreaterThanOrEqual(desc.entries[i].score);
    }

    const asc = await fetchLeaderboard("?sort=asc");
    for (let i = 1; i < asc.entries.length; i++) {
      expect(asc.entries[i - 1].score).toBeLessThanOrEqual(asc.entries[i].score);
    }

    // The two orders are genuinely different views of the same underlying
    // per-player dataset, not the same list twice.
    expect(desc.entries[0].score).toBeGreaterThanOrEqual(asc.entries[0].score);
  });

  it("sorts within a player-name filter the same way as the global list", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 40, 5);

    const desc = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&sort=desc`);
    const asc = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&sort=asc`);
    expect(desc.entries).toHaveLength(1);
    expect(asc.entries).toEqual(desc.entries); // one row either way, same row
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

  it("picks the best run within the date filter, not the all-time best outside it", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 10, 1); // today's only run, modest score

    // A date window that excludes today entirely: this player's one run
    // isn't a candidate, so they must not appear at all.
    const past = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&from=2000-01-01&to=2000-01-02`);
    expect(past.entries).toHaveLength(0);

    // Today's window does include it, with today's score (there's no higher
    // run outside the window to smuggle in instead).
    const today = new Date().toISOString().slice(0, 10);
    const todayResult = await fetchLeaderboard(`?player=${encodeURIComponent(name)}&from=${today}&to=${today}`);
    expect(todayResult.entries).toHaveLength(1);
    expect(todayResult.entries[0].score).toBe(10);
  });

  it("combines player, date and sort filters together", async () => {
    const cookie = await newPlayerCookie();
    const name = await displayNameFor(cookie);
    await submitGame(cookie, 50, 5);

    const today = new Date().toISOString().slice(0, 10);
    const { entries } = await fetchLeaderboard(
      `?player=${encodeURIComponent(name)}&from=${today}&to=${today}&sort=asc`,
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
    const badSort = await fetchLeaderboard("?sort=sideways");
    expect(badSort.status).toBe(400);
    expect(badSort.errors?.length).toBeGreaterThan(0);

    const badDate = await fetchLeaderboard("?from=not-a-date");
    expect(badDate.status).toBe(400);

    const badRange = await fetchLeaderboard("?from=2026-06-01&to=2000-01-01");
    expect(badRange.status).toBe(400);
  });
});

describe("permanently deleting the current player's data", () => {
  it("lets a player delete all of their own game data, removing them from the leaderboard", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    for (const score of [20, 50, 100]) await submitGame(cookieA, score, 10); // several runs

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    await submitGame(cookieB, 10, 1);

    const del = await deleteMe(cookieA);
    expect(del.status).toBe(200);
    const delBody = await del.json();
    expect(delBody.ok).toBe(true);

    // Every one of A's runs is gone, not just their best — a search that
    // would have matched any of their three scores finds nothing at all.
    const after = await fetchLeaderboard(`?player=${encodeURIComponent(nameA)}`);
    expect(after.entries).toHaveLength(0);

    // B, an unrelated player, is completely unaffected.
    const stillThere = await fetchLeaderboard(`?player=${encodeURIComponent(nameB)}`);
    expect(stillThere.entries.some((e) => e.displayName === nameB)).toBe(true);
  });

  it("ignores a client-supplied id and only ever deletes the caller's own data", async () => {
    const cookieA = await newPlayerCookie();
    const nameA = await displayNameFor(cookieA);
    await submitGame(cookieA, 10, 1);

    const cookieB = await newPlayerCookie();
    const nameB = await displayNameFor(cookieB);
    await submitGame(cookieB, 10, 1);

    // Attacker-shaped request: A's own cookie, but a body trying to name B.
    const del = await deleteMe(cookieA, { playerId: 999999, displayName: nameB });
    expect(del.status).toBe(200);

    const bGone = await fetchLeaderboard(`?player=${encodeURIComponent(nameB)}`);
    expect(bGone.entries.some((e) => e.displayName === nameB)).toBe(true); // B untouched

    const aGone = await fetchLeaderboard(`?player=${encodeURIComponent(nameA)}`);
    expect(aGone.entries).toHaveLength(0); // only the caller's own data went away
  });

  it("rejects a delete with no session, and leaves nothing changed", async () => {
    const res = await deleteMe();
    expect(res.status).toBe(404);
  });

  it("cannot be reconnected by replaying the old cookie: a stale token mints a fresh identity instead", async () => {
    const cookie = await newPlayerCookie();
    const oldName = await displayNameFor(cookie);
    await submitGame(cookie, 10, 1);

    const del = await deleteMe(cookie);
    expect(del.status).toBe(200);

    // Deliberately keep using the *old* cookie value, as if a client had
    // ignored the server's Set-Cookie clear — the guarantee has to come
    // from the row being gone, not from the client's cooperation.
    const replay = await fetch(new URL("/api/session", baseUrl), { headers: { cookie } });
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();

    // A brand-new identity, not the deleted one, and the server issues a
    // new token for it rather than accepting the stale one back.
    expect(replayBody.displayName).not.toBe(oldName);
    const newCookie = sessionCookie(replay);
    expect(newCookie).not.toBe(cookie);

    // That new identity's leaderboard activity is unrelated to the deleted
    // one — submitting under it never resurrects the old name or score.
    await submitGame(newCookie, 70, 8);
    const oldNameSearch = await fetchLeaderboard(`?player=${encodeURIComponent(oldName)}`);
    expect(oldNameSearch.entries).toHaveLength(0);
  });

  it("lets a new game, played right after deletion with the same stale cookie, start a clean identity", async () => {
    const cookie = await newPlayerCookie();
    const oldName = await displayNameFor(cookie);
    await submitGame(cookie, 10, 1);
    await deleteMe(cookie);

    // Play again immediately, deliberately reusing the now-stale cookie —
    // this must succeed by minting a new identity, not fail and not revive
    // the old one.
    const res = await fetch(new URL("/api/games", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ score: 30, ticks: 3 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.game.displayName).not.toBe(oldName);

    // That new run is the only thing associated with the new identity: no
    // trace of the deleted player's old score comes back with it.
    const { entries } = await fetchLeaderboard(`?player=${encodeURIComponent(body.game.displayName)}`);
    expect(entries).toHaveLength(1);
    expect(entries[0].score).toBe(30);
  });
});

describe("the leaderboard page", () => {
  it("renders per-player wording, the sort/search controls, and the viewer's own row highlighted", async () => {
    const cookie = await newPlayerCookie();
    // High enough to sit near the top regardless of other test data, so the
    // row — and its highlight/delete action — is actually on the first page.
    await submitGame(cookie, 28000, 2800);

    const res = await fetch(new URL("/leaderboard/", baseUrl), { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ranked by personal best score");
    expect(html).toMatch(/name="player"/);
    expect(html).toMatch(/name="sort"/);
    expect(html).toContain("Highest score first");
    expect(html).toContain("Lowest score first");
    // Precise element matches, not a bare substring check — the shared
    // stylesheet and script both mention "you-badge" / "delete-me" on every
    // page regardless of whether anything actually renders them.
    expect(html).toMatch(/<button[^>]*data-action="delete-me"/);
    expect(html).toMatch(/<span class="you-badge">/);
    expect(html).toMatch(/<tr class="mine">/);

    // The fields this change explicitly removed are gone, not just hidden.
    expect(html).not.toMatch(/name="minScore"/);
    expect(html).not.toMatch(/name="maxScore"/);
  });

  it("does not highlight or show a delete action on another visitor's row", async () => {
    const cookie = await newPlayerCookie();
    await submitGame(cookie, 27000, 2700);
    const name = await displayNameFor(cookie);

    // A second, anonymous visitor viewing the same filtered row.
    const res = await fetch(new URL(`/leaderboard/?player=${encodeURIComponent(name)}`, baseUrl));
    const html = await res.text();
    expect(html).toContain(name);
    expect(html).not.toMatch(/<span class="you-badge">/);
    expect(html).not.toMatch(/<button[^>]*data-action="delete-me"/);
    expect(html).not.toMatch(/<tr class="mine">/);
  });

  it("shows the no-results message for a search with no matches", async () => {
    const res = await fetch(new URL("/leaderboard/?player=__definitely-not-a-real-player__", baseUrl));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No players match your search.");
  });
});

// Not covered here, by nature of being pure client-side behaviour that never
// reaches the server: cancelling the confirm() dialog makes no fetch call at
// all (see src/pages/leaderboard.astro), so there is no HTTP request for a
// spec test to observe — it's verifiable by reading that code path, not by
// driving the deployed contract.
