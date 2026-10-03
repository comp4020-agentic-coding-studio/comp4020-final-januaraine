import type { AstroCookies } from "astro";
import { createPlayer, findPlayerByToken, type Player } from "./db";

export const SESSION_COOKIE = "snake_player";

const NAME_CHARS = "0123456789ABCDEF";

// "Player A7F3" — enough to tell two entries on the leaderboard apart,
// nothing that looks like an account. Generated server-side, same as the
// token itself; see the module comment below for why the client never gets
// a say in either.
function generateDisplayName(): string {
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix += NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)];
  }
  return `Player ${suffix}`;
}

// The only place a player identity is ever minted or looked up. Every route
// that needs "who is this" calls this, reading only the httpOnly cookie —
// never a client-supplied player id from a form field, query string or
// request body. That's what "the server generates the identity" means in
// practice: there is no code path that lets a request assign itself someone
// else's id, because no code path reads an id from anywhere but this cookie.
export function getOrCreatePlayer(cookies: AstroCookies): Player {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    const existing = findPlayerByToken(token);
    if (existing) return existing;
  }

  const sessionToken = crypto.randomUUID();
  const player = createPlayer({ sessionToken, displayName: generateDisplayName() });
  cookies.set(SESSION_COOKIE, sessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  return player;
}
