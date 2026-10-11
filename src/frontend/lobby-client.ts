import { colorFor, renderArena } from "./arena-render";
import type { SerializedArena } from "../game/arena";
import { GRID_SIZE } from "../game/config";
import type { RoomSummary } from "../lib/room-server";

const PREVIEW_PX = 120;

export interface LobbyRefs {
  readonly listEl: HTMLElement;
  readonly emptyEl: HTMLElement;
  readonly searchInput: HTMLInputElement;
  readonly prevButton: HTMLButtonElement;
  readonly nextButton: HTMLButtonElement;
  readonly pageLabel: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly dialogRoomName: HTMLElement;
  readonly dialogCounts: HTMLElement;
  readonly dialogError: HTMLElement;
  readonly joinPlayerButton: HTMLButtonElement;
  readonly joinViewerButton: HTMLButtonElement;
  readonly dialogCancelButton: HTMLButtonElement;
  readonly initialRooms: readonly RoomSummary[];
}

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
        if (ctx) renderArena(ctx, preview, PREVIEW_PX / GRID_SIZE);
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

  function openRoleSelector(room: RoomSummary): void {
    refs.dialogRoomName.textContent = room.name;
    refs.dialogCounts.textContent = `${room.playerCount}/${room.maxPlayers} Players · ${room.viewerCount} Viewers`;
    refs.dialogError.textContent = "";
    refs.dialogError.hidden = true;

    const playerFull = room.playerCount >= room.maxPlayers;
    const playerLocked = room.locked && !room.youAreCreator;
    refs.joinPlayerButton.disabled = playerFull || playerLocked;
    refs.joinPlayerButton.title = playerLocked ? "Players are locked" : playerFull ? `Room is full (${room.maxPlayers}/${room.maxPlayers})` : "";
    refs.joinPlayerButton.dataset.reason = refs.joinPlayerButton.title;

    refs.joinViewerButton.disabled = !room.allowViewers;
    refs.joinViewerButton.title = room.allowViewers ? "" : "Viewers are not allowed in this room";
    refs.joinViewerButton.dataset.reason = refs.joinViewerButton.title;

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

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  refs.searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = refs.searchInput.value.trim();
      page = 1;
      openStream();
    }, 250);
  });

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
