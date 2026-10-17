import type { RoomSummary } from "../lib/room-server";

const PLAYER_DESCRIPTION = "Control your own snake and compete for the leaderboard.";

// The subset of the role-dialog's DOM refs needed to populate and submit
// it — shared by the lobby (arena.astro, dialog opened on a room-card click)
// and the room page (room/[id].astro, dialog opened immediately on load for
// a visitor who isn't a member yet). Both pages render the exact same
// `<dialog id="role-dialog">` markup, so this is the one place its
// fill-in-the-fields and join-request logic lives.
export interface RoleDialogRefs {
  readonly dialogRoomName: HTMLElement;
  readonly dialogCounts: HTMLElement;
  readonly dialogCapacityDots: HTMLElement;
  readonly dialogViewerCount: HTMLElement;
  readonly dialogError: HTMLElement;
  readonly joinPlayerButton: HTMLButtonElement;
  readonly joinPlayerDesc: HTMLElement;
  readonly joinViewerButton: HTMLButtonElement;
}

// Purely decorative (the text counts above already say the same thing
// accessibly) — one dot per Player slot, filled for an occupied one.
function renderCapacityDots(container: HTMLElement, playerCount: number, maxPlayers: number): void {
  const dots = Array.from({ length: maxPlayers }, (_, i) => {
    const dot = document.createElement("span");
    dot.className = i < playerCount ? "capacity-dot filled" : "capacity-dot";
    return dot;
  });
  container.replaceChildren(...dots);
}

// Fills the dialog's fields for the given room. Does not open the dialog —
// callers open it however fits their own flow (on a click, or immediately on
// page load).
export function populateRoleDialog(refs: RoleDialogRefs, room: RoomSummary): void {
  refs.dialogRoomName.textContent = room.name;
  refs.dialogCounts.textContent = `${room.playerCount} / ${room.maxPlayers} Players`;
  renderCapacityDots(refs.dialogCapacityDots, room.playerCount, room.maxPlayers);
  refs.dialogViewerCount.textContent =
    room.viewerCount === 1 ? "1 Viewer watching" : `${room.viewerCount} Viewers watching`;
  refs.dialogError.textContent = "";
  refs.dialogError.hidden = true;

  // Player joining is always offered, explained when it's unavailable
  // (reused server-authoritative reasons — see room-server.ts's joinRoom).
  // Viewer joining has no equivalent capacity limit, so its only possible
  // reason is a room setting, not a transient state — when that setting
  // says no, the option is hidden entirely rather than shown disabled.
  const playerFull = room.playerCount >= room.maxPlayers;
  const playerLocked = room.locked && !room.youAreCreator;
  const playerBlockedReason = playerLocked
    ? "Players are locked."
    : playerFull
      ? `Room is full (${room.maxPlayers}/${room.maxPlayers}).`
      : "";
  refs.joinPlayerButton.disabled = playerBlockedReason !== "";
  refs.joinPlayerButton.classList.toggle("role-choice-blocked", playerBlockedReason !== "");
  refs.joinPlayerButton.dataset.reason = playerBlockedReason;
  refs.joinPlayerDesc.textContent = playerBlockedReason || PLAYER_DESCRIPTION;

  refs.joinViewerButton.hidden = !room.allowViewers;
  refs.joinViewerButton.disabled = false;
  refs.joinViewerButton.dataset.reason = "";
}

// Submits the join request for the given role and reports the result. The
// caller decides what happens next on success (the lobby navigates to the
// room; the room page just reloads itself) — this only owns the request and
// the dialog's own error/disabled-state feedback.
export async function confirmRoleJoin(
  refs: RoleDialogRefs,
  roomId: number,
  role: "player" | "viewer",
  onSuccess: () => void,
): Promise<void> {
  refs.joinPlayerButton.disabled = true;
  refs.joinViewerButton.disabled = true;
  try {
    const res = await fetch(`/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      onSuccess();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { reason?: string };
    refs.dialogError.textContent = data.reason ?? "Could not join the room.";
    refs.dialogError.hidden = false;
    // Re-enable whichever action is still actually valid — never silently
    // re-attempt with the other role.
    refs.joinPlayerButton.disabled = refs.joinPlayerButton.dataset.reason !== "";
    refs.joinViewerButton.disabled = refs.joinViewerButton.dataset.reason !== "";
  } catch {
    refs.dialogError.textContent = "Couldn't reach the server.";
    refs.dialogError.hidden = false;
    refs.joinPlayerButton.disabled = refs.joinPlayerButton.dataset.reason !== "";
    refs.joinViewerButton.disabled = refs.joinViewerButton.dataset.reason !== "";
  }
}
