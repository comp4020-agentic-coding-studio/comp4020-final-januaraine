# ADR-002: Room-based multiplayer supersedes the single shared arena

## Status

Proposed — implemented this session, pending the user's review and commit.
Supersedes [ADR-001](./ADR-001-realtime-multiplayer.md)'s "one continuous
shared arena" decision specifically on the rooms question; ADR-001's other
conclusions (SSE+POST transport, server authority, the disconnect-grace
pattern) are reused unchanged, not revisited.

## Context

ADR-001 chose one continuous shared arena over rooms, reasoning that a room
lifecycle was exactly the kind of extra state machine the C9 brief at the
time said not to build "unless the existing architecture makes it
necessary." The brief now explicitly requires room-based multiplayer: a
lobby of named, searchable rooms, each with its own Player/Viewer
membership, a 5-Player cap, independent lock/visibility settings, and a
live preview. That's a different brief, not evidence ADR-001's original
reasoning was wrong for the brief it answered — this ADR records the new
decision on its own terms.

The one design question worth a written record here (per the brief's own
suggestion) is **what a room's settings actually control**, because it's
easy to collapse three different questions into one:

1. Can a user *see* this room exists at all, and glimpse its live game? (visibility / preview)
2. Can a user *watch* this room's game in real time as a Viewer?
3. Can a user *become a Player* in this room?

## Decision

Three independent axes, not one:

- **`locked`** ("Lock player joining") controls only (3): whether anyone
  but the room's creator can become a Player. It is *not* a password and
  does not gate (1) or (2).
- **`allowViewers`** ("Allow public viewers") controls only (2): whether
  anyone but existing members can join as a Viewer. Independent of
  `locked` — a locked, solo-play room can still let the world watch.
- **Capacity** (`playerCount < 5`) is a separate, always-on constraint on
  (3), orthogonal to both flags: even an unlocked room rejects a sixth
  Player.

The lobby's live preview (1) is gated by the *combination* `!locked &&
allowViewers` — a room is only ever shown playing live to someone who
isn't a member yet if both "this room is watchable at all" and "this
room isn't solo-play" hold. This is enforced in
`src/lib/room-server.ts`'s `getRoomPreview`, which returns `null` for any
other combination regardless of what a caller asks for — the same
function the lobby's SSE route calls, so there is no second "is this
actually allowed" check the UI could get out of sync with.

Role requests from the lobby (and later, mid-session) are validated
against exactly these three axes, atomically, server-side, every time —
never cached from what the client last saw. A rejected "Join as Player"
or "Join as Viewer" request is reported as-is; it is never silently
satisfied by the other role.

## Alternatives considered

**Password-protected rooms**, rather than `locked` meaning solo-play. The
brief is explicit that a locked room is not a password-protected one — the
implementation follows that literally: `locked` only ever compares a
request's player id against the room's `creatorPlayerId`, there is no
shared secret anywhere in the room model.

**A single "visibility" flag** combining preview and Viewer access,
instead of two. Rejected: the brief's own locked-room semantics require a
locked room to still admit Viewers when the creator wants an audience,
which only works if "can watch" is a separate switch from "is this room
generally public." Folding them into one flag would make that
combination unrepresentable.

**Trusting the client to hide a locked/no-viewer room's preview**, rather
than having the server refuse to serve it. Rejected outright, not just on
principle: the brief explicitly calls this out ("Do not expose the locked
room's live game state through an unauthorized API or event stream merely
because the preview is hidden in the UI"), and a server that only hides
data in the renderer is one `curl` away from leaking it.

## Costs and limitations

- **One room at a time per player.** Joining a second room's lobby card
  first leaves whatever room you were already a member of (Player or
  Viewer). This keeps a player's identity single-room, at the cost of not
  supporting "watch two rooms side by side" — not asked for by the brief,
  and would otherwise complicate every membership/capacity check with "in
  which room."
- **Rooms don't survive a server restart.** Room *metadata* (name, flags)
  lives in SQLite for uniqueness and listing, but a room's live state
  (arena, membership, connections) is memory-only, exactly like the
  single arena it replaces — same single-instance, `--ha=false`
  assumption ADR-001 already relies on, now also covering rooms. Rather
  than leave DB rows with no matching runtime after a restart, `db.ts`
  truncates the `rooms` table once at boot. A real deploy restart means
  every room closes; this is a deliberate, documented consequence, not a
  silently-discovered bug.
- **Creator-departure closes the room.** Chosen over "promote the next
  Player to creator" or "leave the room open, ownerless" as the simplest
  policy that still has a clear, single owner for the lifetime of a room:
  no vote, no succession rule to get right under concurrency. The cost is
  that a creator's accidental disconnect (past the same grace window a
  Player's disconnect already uses) ends the room for everyone in it —
  acceptable for a casual arcade game, not necessarily for a "serious"
  competitive room, which this game doesn't claim to be.
- **No horizontal scaling story**, inherited unchanged from ADR-001: still
  one Fly machine, one Node process, a module-level `Map` of rooms instead
  of one shared arena. If a future crit needs multiple instances, this
  needs revisiting (a pub/sub layer, or sharding rooms by instance)
  rather than continuing to work by accident.
