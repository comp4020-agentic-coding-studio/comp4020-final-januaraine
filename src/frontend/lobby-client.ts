import { colorFor, readPalette, renderArena } from "./arena-render";
import type { SerializedArena } from "../game/arena";
import { GRID_SIZE } from "../game/config";
import type { RoomSummary } from "../lib/room-server";

const PREVIEW_PX = 120;

export interface LobbyRefs {
  readonly listEl: HTMLElement;
  readonly emptyEl: HTMLElement;
  readonly searchInput: HTMLInputElement;
  readonly searchButton: HTMLButtonElement;
  readonly prevButton: HTMLButtonElement;
  readonly nextButton: HTMLButtonElement;
  readonly pageLabel: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly dialogRoomName: HTMLElement;
  readonly dialogCounts: HTMLElement;
  readonly dialogCapacityDots: HTMLElement;
  readonly dialogViewerCount: HTMLElement;
  readonly dialogError: HTMLElement;
  readonly joinPlayerButton: HTMLButtonElement;
  readonly joinPlayerDesc: HTMLElement;
  readonly joinViewerButton: HTMLButtonElement;
  readonly dialogCancelButton: HTMLButtonElement;
  readonly initialRooms: readonly RoomSummary[];
}

const PLAYER_DESCRIPTION = "Control your own snake and compete for the leaderboard.";

interface LobbyFrame {
  rooms: RoomSummary[];
  previews: Record<number, SerializedArena>;
}

// Drives the lobby's live room list + the role-selector dialog. Reuses the
// exact same renderArena/colorFor the room canvas uses for each card's mini
// preview — a preview is "the actual room, drawn small," never a second
// simulation.
export function initLobby(refs: LobbyRefs): () => void {
  let search = "";
  let page = 1;
  let source: EventSource | null = null;
  let latestRooms: RoomSummary[] = [...refs.initialRooms];

  function roomIdsOnScreen(): number[] {
    return latestRooms.filter((r) => !r.locked && r.allowViewers).map((r) => r.id);
  }

  function openStream(): void {
    source?.close();
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    params.set("page", String(page));
    const previewIds = roomIdsOnScreen();
    if (previewIds.length > 0) params.set("preview", previewIds.join(","));

    source = new EventSource(`/api/rooms/stream?${params.toString()}`);
    source.onmessage = (event: MessageEvent<string>) => {
      const frame = JSON.parse(event.data) as LobbyFrame;
      latestRooms = frame.rooms;
      render(frame);
      refs.nextButton.disabled = frame.rooms.length < 20;
      refs.prevButton.disabled = page <= 1;
      refs.pageLabel.textContent = `Page ${page}`;
    };
  }

  function render(frame: LobbyFrame): void {
    refs.listEl.replaceChildren(...frame.rooms.map((room) => renderCard(room, frame.previews[room.id])));
    refs.emptyEl.hidden = frame.rooms.length > 0;
  }

  function renderCard(room: RoomSummary, preview: SerializedArena | undefined): HTMLElement {
    const card = document.createElement("article");
    card.className = "room-card panel";

    const title = document.createElement("h3");
    title.textContent = room.name;
    if (room.locked) {
      const lock = document.createElement("span");
      lock.className = "room-lock-icon";
      lock.setAttribute("aria-label", "Locked: player joining disabled");
      lock.textContent = " 🔒";
      title.append(lock);
    }

    const counts = document.createElement("p");
    counts.className = "room-counts";
    counts.textContent = `${room.playerCount}/${room.maxPlayers} Players · ${room.viewerCount} Viewers`;

    const previewBox = document.createElement("div");
    previewBox.className = "room-preview";
    if (!room.locked && room.allowViewers) {
      const canvas = document.createElement("canvas");
      canvas.width = PREVIEW_PX;
      canvas.height = PREVIEW_PX;
      canvas.setAttribute("aria-hidden", "true");
      previewBox.append(canvas);
      if (preview) {
        const ctx = canvas.getContext("2d");
        // No explicit redraw-on-theme-change needed here, unlike
        // room-client.ts's board: every card (canvas included) is already
        // torn down and rebuilt from scratch on each ~400ms poll frame, so
        // a toggle is reflected within one poll cycle regardless.
        if (ctx) renderArena(ctx, preview, PREVIEW_PX / GRID_SIZE, readPalette());
      }
    } else {
      previewBox.classList.add("room-preview-locked");
      previewBox.textContent = room.locked ? "🔒 Locked room" : "No public viewing";
    }

    const enterButton = document.createElement("button");
    enterButton.type = "button";
    enterButton.className = "button primary";
    enterButton.textContent = "Enter Room";
    enterButton.addEventListener("click", () => openRoleSelector(room));

    card.append(title, counts, previewBox, enterButton);
    return card;
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

  function openRoleSelector(room: RoomSummary): void {
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

    refs.dialog.dataset.roomId = String(room.id);
    refs.dialog.showModal();
  }

  async function confirmJoin(role: "player" | "viewer"): Promise<void> {
    const roomId = Number(refs.dialog.dataset.roomId);
    refs.joinPlayerButton.disabled = true;
    refs.joinViewerButton.disabled = true;
    try {
      const res = await fetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (res.ok) {
        window.location.href = `/room/${roomId}/`;
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

  refs.joinPlayerButton.addEventListener("click", () => void confirmJoin("player"));
  refs.joinViewerButton.addEventListener("click", () => void confirmJoin("viewer"));
  refs.dialogCancelButton.addEventListener("click", () => refs.dialog.close());

  // The room-name field searches live as you type (debounced below) — the
  // Search button and Enter key both just run that same search immediately,
  // for whoever prefers to type first and trigger it deliberately. Neither
  // path ever touches /api/rooms (room creation): that's the separate
  // Create Room button's own handler, in arena.astro.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  function runSearch(): void {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
    search = refs.searchInput.value.trim();
    page = 1;
    openStream();
  }

  refs.searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });
  refs.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    runSearch();
  });
  refs.searchButton.addEventListener("click", runSearch);

  refs.prevButton.addEventListener("click", () => {
    if (page <= 1) return;
    page -= 1;
    openStream();
  });
  refs.nextButton.addEventListener("click", () => {
    page += 1;
    openStream();
  });

  openStream();
  render({ rooms: latestRooms, previews: {} });

  return () => source?.close();
}

// Exported for completeness/testing symmetry with arena-render's own export.
export { colorFor };
