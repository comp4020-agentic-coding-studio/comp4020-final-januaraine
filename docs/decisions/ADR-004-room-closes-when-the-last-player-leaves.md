# ADR-004: A room closes when it has no Players left, even if Viewers remain

## Status

Accepted — implemented this session. Supersedes the core decision of
[ADR-003](./ADR-003-room-lifetime-is-member-count-based.md) ("a room stays
alive while **any** member remains, Player or Viewer"). Everything else
ADR-003 and [ADR-002](./ADR-002-room-based-multiplayer.md) decided — the
three independent settings axes, one room per player, rooms don't survive a
restart, the creator's only remaining privilege being a locked room's
Player-joining bypass — is unchanged.

## Context

ADR-003 explicitly flagged this as a known, accepted gap at the time:

> A room with only Viewers and no Players can stay open indefinitely —
> previously impossible... Not addressed here: nothing currently closes a
> room that's "technically alive but nobody is actually playing." Acceptable
> for now — out of scope for this session, and easy to add later (e.g. close
> if zero Players persist for N minutes) without revisiting this ADR's core
> decision.

That gap is now a real product problem, not just a theoretical one: a room
with Viewers but no Players sits in the lobby forever showing an idle board,
nobody able to do anything about it, consuming a tick loop for a game with
no one playing it. Snake Arena is about playing, not spectating an empty
grid — a room's reason to exist is tied to whether anyone can actually be
*in* the game.

## Decision

A room stays alive while **at least one Player** remains, regardless of how
many Viewers are also present. It closes the instant the last Player is
gone, whichever of these caused it:

- An intentional departure (`leaveRoom`) where the departing member was the
  room's only Player.
- An explicit role switch to Viewer (`becomeViewer`, or the same-room branch
  of `joinRoom`) where the switching member was the only Player.
- A disconnect-grace window (`unregisterRoomConnection`) elapsing with no
  reconnect for a member who was the only Player.

All three now route through one shared check, `closeRoomIfNoPlayersLeft`, in
`src/lib/room-server.ts` — the direct successor to ADR-003's
`closeRoomIfEmpty`, with the test changed from "is anyone left at all" to
"is any Player left." The creator's identity still matters for exactly one
thing, unchanged since ADR-002: a locked room's Player-joining bypass
(`isCreator` checks in `joinRoom`/`becomePlayer`). A creator leaving while
another Player remains does **not** close the room — lifetime was never
creator-based (ADR-003 already established that) and still isn't.

### Viewers are notified, not just disconnected

When a room closes with Viewers still present, they're exactly the audience
who needs to find out: `closeRoom`'s existing SSE `closed` event (reason
text plus a connection close) already reaches every open connection in the
room, Viewers included, and it's always sent *before* the connection
actually closes — enqueuing to a stream and then closing it preserves order,
so there is no delivery race to engineer around. `closeRoomIfNoPlayersLeft`
picks a clearer reason string for this specific case ("The last Player has
left. This room is closing.") than the generic empty-room case, since this
is the one a human is actually meant to read.

The "give Viewers a moment to read it, then send them back to the lobby"
behavior is deliberately a client-side concern (`room/[id].astro`'s `closed`
handler), not a server-side delay: the server has nothing further to do once
the notification is enqueued, and holding the runtime open any longer would
just be a slower version of the problem this ADR fixes. A Viewer who was
mid-switch when the room closed (the "last Player becomes a Viewer" case)
receives this exact same event on their own connection — "notify all
remaining Viewers, including the one who just became a Viewer" falls out of
`becomeViewer` updating the role *before* checking for closure, rather than
needing special-case code.

### No new "closing" state

Because every mutation here is synchronous (no `await` between "a Player
left" and "the room is gone"), there's no window in which a room is
"closing but not yet closed" for a concurrent request to observe. A room is
either still open (`rooms.get(roomId)` returns the live runtime, a Player is
in it) or already fully torn down (deleted from the registry and the
database, its tick loop and disconnect timers cleared, every connection
notified and closed). "Don't let a Viewer become a Player in a closing
room" is therefore a free consequence of every join path's existing
`!runtime` check — it doesn't need its own flag or lifecycle state.

## Costs and limitations

- **Leaderboard rows are still unaffected, for the same reason ADR-003 gave**:
  `recordGameResult` writes to the `games` table independently of `rooms`/the
  runtime, and `closeRoom` never touches it. Unchanged by this ADR; tested
  explicitly in `spec/rooms.test.ts`.
- **A locked (solo) room closes under this same rule** if its creator
  leaves or disconnects past grace without anyone else ever having been a
  Player in it (which is the common case, since `locked` keeps everyone else
  from becoming one) — no special case needed, since "zero Players" doesn't
  care whether the room was ever meant to hold more than one.
