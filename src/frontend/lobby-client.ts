import { colorFor, readPalette, renderArena } from "./arena-render";
import { confirmRoleJoin, populateRoleDialog } from "./role-dialog";
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

  // No `preview=<ids>` param: the server derives which rooms to preview from
  // the exact same search+page result it computes fresh on every push (see
  // stream.ts), so a room created after this connection is already open
  // still gets a preview on the very next push, with no need to reopen the
  // EventSource. Only `q`/`page` select which *rooms* this connection
  // watches at all; previewing is then "every one of those," not a second,
  // separately-stale list.
  function openStream(): void {
    source?.close();
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    params.set("page", String(page));

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

  function openRoleSelector(room: RoomSummary): void {
    populateRoleDialog(refs, room);
    refs.dialog.dataset.roomId = String(room.id);
    refs.dialog.showModal();
  }

  async function confirmJoin(role: "player" | "viewer"): Promise<void> {
    const roomId = Number(refs.dialog.dataset.roomId);
    await confirmRoleJoin(refs, roomId, role, () => {
      window.location.href = `/room/${roomId}/`;
    });
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

  // The room page's back button navigates here with `history.back()` (see
  // room/[id].astro) when it can, which the browser may satisfy from the
  // back/forward cache: this exact script instance and DOM are restored
  // frozen, not re-run, so a dialog left open mid-join (confirmJoin disables
  // both buttons right before `window.location.href` takes over, and never
  // gets a chance to re-enable them) reappears stuck open with dead
  // buttons. `pageshow`'s `persisted` flag is the standard signal for a
  // bfcache restore — close the stale dialog and refresh the room stream so
  // the lobby is immediately interactive again, exactly as a fresh load
  // would leave it.
  function onPageShow(event: PageTransitionEvent): void {
    if (!event.persisted) return;
    refs.dialog.close();
    refs.dialogError.hidden = true;
    openStream();
  }
  window.addEventListener("pageshow", onPageShow);

  openStream();
  render({ rooms: latestRooms, previews: {} });

  return () => {
    source?.close();
    window.removeEventListener("pageshow", onPageShow);
  };
}

// Exported for completeness/testing symmetry with arena-render's own export.
export { colorFor };
