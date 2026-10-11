# ADR-003: Room lifetime is member-count-based, not creator-based

## Status

Accepted — implemented this session. Supersedes exactly one clause of
[ADR-002](./ADR-002-room-based-multiplayer.md): "Creator-departure closes
the room." Everything else ADR-002 decided (the three independent axes a
room's settings control — visibility, viewer access, Player-joining
permission; one room per player; rooms don't survive a restart) is
unchanged.

## Context

ADR-002 chose "the room closes when its creator leaves or disconnects past
grace" as the simplest rule with an unambiguous, single owner for a room's
whole lifetime. That rule depended on there being a distinct `Leave Room`
action a creator could take that a Viewer/other Player's departure didn't
share semantically.

This session removes the explicit `Leave Room` button entirely: leaving a
room is now just *navigating away*, the same action regardless of whether
you created the room or joined through the lobby. Once the only thing that
can trigger "a member left" is navigation, "and if that member happened to
be the creator, also destroy the room for everyone else still in it"
becomes an arbitrary, surprising special case rather than a meaningful
product decision — four people could be mid-game, the fifth (who happened
to click Create Room first) clicks a nav link, and their game ends for no
reason connected to anything happening in the game itself.

## Decision

A room stays alive while **any** member remains, Player or Viewer, creator
or not. It closes exactly when the last member leaves (`leaveRoom`) or the
last member's disconnect-grace window elapses with no reconnect
(`unregisterRoomConnection`) — both now routed through one shared check,
`closeRoomIfEmpty`, in `src/lib/room-server.ts`. The creator's identity
still matters for exactly one thing, unchanged from ADR-002: a locked
room's Player-joining bypass (`isCreator` checks in `joinRoom`/
`becomePlayer`). Lifetime and access permission are, and remain, two
independent axes — this ADR only changes the first.

## Intentional departure vs. temporary disconnection

This distinction is what the navigation-cleanup work in `room/[id].astro`
actually depends on, so it's worth being explicit:

- **Intentional departure** — the Back button (an awaited call to
  `POST /api/rooms/:id/leave` before navigating), a click on any in-app
  link (a `sendBeacon` fired to the same endpoint, non-blocking), or a
  `pagehide` firing that same beacon as a last-resort signal for a refresh
  or tab close. All of these call `leaveRoom`, which removes the member
  **immediately**, no grace window.
- **Temporary disconnection** — the SSE connection simply drops with no
  accompanying departure signal (a network blip, a crash before `pagehide`
  could run, a beacon that never arrived). This is `unregisterRoomConnection`'s
  job: it starts `DISCONNECT_GRACE_MS` (prod default 5s) before actually
  removing the member, so an ordinary reconnect resumes the same membership
  with nothing lost. Unchanged by this ADR — only *what happens once a
  member is actually gone* (member-count-based closure, not creator-based)
  changed, not *when* a disconnected member is considered gone.

Both paths are idempotent at the point that matters: `leaveRoom` no-ops if
the member is already gone (`!runtime.members.has(playerId)`) and no-ops if
the room itself is already gone (`!runtime` — e.g. a stray duplicate beacon
arriving after the room already closed because someone else was the actual
last member). This is what makes firing the departure signal from multiple
overlapping browser lifecycle events (a nav-link click *and* a `pagehide*
racing it) safe without needing to coordinate them precisely.

## Costs and limitations

- **A room with only Viewers and no Players can stay open indefinitely** —
  previously impossible (the creator, if still a Player, was required for
  the room to exist at all; now any mix of members keeps it alive). Not
  addressed here: nothing currently closes a room that's "technically
  alive but nobody is actually playing." Acceptable for now — out of scope
  for this session, and easy to add later (e.g. close if zero Players
  persist for N minutes) without revisiting this ADR's core decision.
- **Leaderboard rows are unaffected, by construction, not by a new
  safeguard**: `recordGameResult` (called from the per-room tick loop on
  elimination) writes to the `games` table independently of `rooms`/the
  in-memory runtime; `closeRoom` only ever deletes the `rooms` row and
  tears down the runtime. There was never a code path connecting the two,
  so "leaderboard records survive room closure" was true before this ADR
  as well — it's called out explicitly here, and tested explicitly in
  `spec/rooms.test.ts`, because the brief asked for it to be a *checked*
  property, not an assumed one.
