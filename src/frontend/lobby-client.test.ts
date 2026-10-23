// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initLobby, type LobbyRefs } from "./lobby-client";
import type { RoomSummary } from "../lib/room-server";

// jsdom has no EventSource; initLobby opens one immediately on init and
// again on every search, so a minimal fake — just enough surface for
// initLobby's own usage — stands in for it.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(): void {}
  close(): void {
    this.closed = true;
  }
}

function buildRefs(initialRooms: RoomSummary[] = []): LobbyRefs {
  document.body.innerHTML = `
    <ul id="rooms-list"></ul>
    <p id="rooms-empty" hidden></p>
    <input id="room-search" type="search" />
    <button id="room-search-button" type="button">Search</button>
    <button id="rooms-prev" type="button"></button>
    <button id="rooms-next" type="button"></button>
    <span id="rooms-page-label"></span>
    <dialog id="role-dialog">
      <h2 id="role-dialog-title">Join room</h2>
      <p id="role-dialog-room-name"></p>
      <span id="role-dialog-counts"></span>
      <span id="role-dialog-capacity-dots"></span>
      <p id="role-dialog-viewer-count"></p>
      <p id="role-dialog-error" hidden></p>
      <button id="join-as-player" type="button">
        <span id="join-as-player-desc"></span>
      </button>
      <button id="join-as-viewer" type="button"></button>
      <button id="role-dialog-cancel" type="button"></button>
    </dialog>
  `;
  // jsdom doesn't implement <dialog>'s showModal()/close() (they throw
  // "not implemented") — harmless no-op stubs here, since this file is
  // testing the lobby's own logic, not browser dialog behavior itself.
  const dialog = document.getElementById("role-dialog") as HTMLDialogElement;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
  };
  return {
    listEl: document.getElementById("rooms-list")!,
    emptyEl: document.getElementById("rooms-empty")!,
    searchInput: document.getElementById("room-search") as HTMLInputElement,
    searchButton: document.getElementById("room-search-button") as HTMLButtonElement,
    prevButton: document.getElementById("rooms-prev") as HTMLButtonElement,
    nextButton: document.getElementById("rooms-next") as HTMLButtonElement,
    pageLabel: document.getElementById("rooms-page-label")!,
    dialog,
    dialogRoomName: document.getElementById("role-dialog-room-name")!,
    dialogCounts: document.getElementById("role-dialog-counts")!,
    dialogCapacityDots: document.getElementById("role-dialog-capacity-dots")!,
    dialogViewerCount: document.getElementById("role-dialog-viewer-count")!,
    dialogError: document.getElementById("role-dialog-error")!,
    joinPlayerButton: document.getElementById("join-as-player") as HTMLButtonElement,
    joinPlayerDesc: document.getElementById("join-as-player-desc")!,
    joinViewerButton: document.getElementById("join-as-viewer") as HTMLButtonElement,
    dialogCancelButton: document.getElementById("role-dialog-cancel") as HTMLButtonElement,
    initialRooms,
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

describe("lobby search", () => {
  it("clicking Search opens a fresh stream with the typed query, and never touches room creation", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const refs = buildRefs();
    const stop = initLobby(refs);

    refs.searchInput.value = "snake pit";
    refs.searchButton.click();

    const latest = FakeEventSource.instances.at(-1)!;
    expect(latest.url).toContain("q=snake+pit");
    expect(fetchSpy).not.toHaveBeenCalled();
    stop();
  });

  it("pressing Enter in the search field runs the same search immediately, bypassing the debounce", () => {
    const refs = buildRefs();
    const stop = initLobby(refs);
    const beforeCount = FakeEventSource.instances.length;

    refs.searchInput.value = "arena";
    refs.searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(FakeEventSource.instances.length).toBe(beforeCount + 1);
    const latest = FakeEventSource.instances.at(-1)!;
    expect(latest.url).toContain("q=arena");
    stop();
  });

  it("an empty query searches for everything — no leftover q param from a prior search", () => {
    const refs = buildRefs();
    const stop = initLobby(refs);

    refs.searchInput.value = "temp";
    refs.searchButton.click();
    refs.searchInput.value = "";
    refs.searchButton.click();

    const latest = FakeEventSource.instances.at(-1)!;
    expect(latest.url).not.toContain("q=");
    stop();
  });

  it("resets to page 1 when a new search runs", () => {
    const refs = buildRefs();
    const stop = initLobby(refs);

    refs.nextButton.click();
    refs.nextButton.click();
    refs.searchInput.value = "pit";
    refs.searchButton.click();

    const latest = FakeEventSource.instances.at(-1)!;
    expect(latest.url).toContain("page=1");
    stop();
  });
});

// Regression test for the "lobby preview only appears after a manual
// refresh" bug: the client used to compute a `preview=<ids>` query param
// once, from whatever rooms it already knew about at connection-open time,
// and never touched it again — so a room created after the lobby's
// EventSource was already open could never get a preview until the whole
// connection was reopened (e.g. an F5). The fix removes that param
// entirely: the server now derives which rooms to preview from the same
// room list it recomputes every push (see stream.ts), so there is no
// client-held id list left to go stale.
describe("lobby preview: no client-held id list to go stale", () => {
  it("never sends a preview= param — the server decides which rooms to preview on every push, not the client once", () => {
    const refs = buildRefs();
    const stop = initLobby(refs);

    const latest = FakeEventSource.instances.at(-1)!;
    expect(latest.url).not.toContain("preview=");
    stop();
  });

  it("still sends no preview= param even once rooms are already known on screen", () => {
    // Before the fix, this is exactly the case that got baked into the URL
    // once and then never updated: a room visible at connection-open time.
    const refs = buildRefs([baseRoom({ id: 7, locked: false, allowViewers: true })]);
    const stop = initLobby(refs);

    const latest = FakeEventSource.instances.at(-1)!;
    expect(latest.url).not.toContain("preview=");
    stop();
  });

  it("renders a room's preview from a later frame without reopening the connection — the exact previously-broken lifecycle", () => {
    const refs = buildRefs();
    const stop = initLobby(refs);
    const streamCountAfterOpen = FakeEventSource.instances.length;

    const source = FakeEventSource.instances.at(-1)!;
    // First frame: no rooms exist yet (the lobby loaded before anyone
    // created one) — exactly the reported repro's starting state.
    source.onmessage?.({ data: JSON.stringify({ rooms: [], previews: {} }) } as MessageEvent);
    expect(refs.listEl.children).toHaveLength(0);

    // A room is created and starts ticking *after* this connection already
    // opened. The server's next push now includes both the room summary and
    // its preview in the SAME frame, on the SAME still-open connection — no
    // second EventSource, which is exactly what the bug used to require.
    const newRoom = baseRoom({ id: 42, locked: false, allowViewers: true });
    source.onmessage?.({
      data: JSON.stringify({
        rooms: [newRoom],
        previews: { 42: { gridSize: 20, food: [], snakes: [{ displayName: "P", segments: [{ x: 1, y: 1 }], score: 0, isMine: false }], dying: [] } },
      }),
    } as MessageEvent);

    expect(FakeEventSource.instances.length).toBe(streamCountAfterOpen); // no reopen happened
    const canvas = refs.listEl.querySelector("canvas");
    expect(canvas).not.toBeNull();
    stop();
  });
});

function baseRoom(overrides: Partial<RoomSummary> = {}): RoomSummary {
  return {
    id: 1,
    name: "Test Room",
    playerCount: 1,
    maxPlayers: 5,
    viewerCount: 0,
    locked: false,
    allowViewers: true,
    youAreCreator: false,
    ...overrides,
  };
}

function openDialogFor(refs: LobbyRefs): void {
  const stop = initLobby(refs);
  refs.listEl.querySelector<HTMLButtonElement>("button.primary")!.click();
  stop();
}

// These mirror the server-authoritative rules in src/lib/room-server.ts
// (joinRoom/becomePlayer) — the dialog only ever reflects what the server
// would actually accept, never a UI-only guess.
describe("role-selector modal: reuses server-authoritative room rules", () => {
  it("disables Join as Player with a visible reason when the room is locked for a non-creator", () => {
    const refs = buildRefs([baseRoom({ locked: true, youAreCreator: false })]);
    openDialogFor(refs);

    expect(refs.joinPlayerButton.disabled).toBe(true);
    expect(refs.joinPlayerDesc.textContent).toContain("locked");
    expect(refs.joinViewerButton.hidden).toBe(false);
  });

  it("still enables Join as Player for the room's own creator, even when it's locked", () => {
    const refs = buildRefs([baseRoom({ locked: true, youAreCreator: true })]);
    openDialogFor(refs);

    expect(refs.joinPlayerButton.disabled).toBe(false);
  });

  it("disables Join as Player with a visible reason when the room is at the five-Player cap", () => {
    const refs = buildRefs([baseRoom({ playerCount: 5, maxPlayers: 5 })]);
    openDialogFor(refs);

    expect(refs.joinPlayerButton.disabled).toBe(true);
    expect(refs.joinPlayerDesc.textContent).toContain("5/5");
  });

  it("hides the Viewer option entirely (not just disables it) when the room disallows public viewing", () => {
    const refs = buildRefs([baseRoom({ allowViewers: false })]);
    openDialogFor(refs);

    expect(refs.joinViewerButton.hidden).toBe(true);
    // The Player option is unaffected by a viewer-visibility setting.
    expect(refs.joinPlayerButton.disabled).toBe(false);
  });

  it("shows the current Player count prominently and leaves Join as Player enabled when a slot is free", () => {
    const refs = buildRefs([baseRoom({ playerCount: 2, maxPlayers: 5 })]);
    openDialogFor(refs);

    expect(refs.dialogCounts.textContent).toBe("2 / 5 Players");
    expect(refs.joinPlayerButton.disabled).toBe(false);
    expect(refs.joinViewerButton.hidden).toBe(false);
  });
});

// Reproduces the stale-modal bug: the room page's back button can return
// here via history.back(), which the browser may serve from the
// back/forward cache — this exact script instance and DOM frozen mid-join,
// dialog open, both buttons disabled (confirmJoin disables them right
// before the navigation that never lets it re-enable them).
describe("bfcache restore (pageshow with persisted)", () => {
  it("closes a dialog left open from before navigating away, and refreshes the room stream", () => {
    const refs = buildRefs([baseRoom()]);
    const stop = initLobby(refs);
    refs.listEl.querySelector<HTMLButtonElement>("button.primary")!.click();
    refs.joinPlayerButton.disabled = true;
    refs.joinViewerButton.disabled = true;
    expect(refs.dialog.open).toBe(true);
    const streamCountBeforeRestore = FakeEventSource.instances.length;

    window.dispatchEvent(new Event("pageshow"));
    expect(refs.dialog.open).toBe(true); // a normal pageshow (persisted: false) must not touch it

    const persistedEvent = new Event("pageshow");
    Object.defineProperty(persistedEvent, "persisted", { value: true });
    window.dispatchEvent(persistedEvent);

    expect(refs.dialog.open).toBe(false);
    expect(FakeEventSource.instances.length).toBe(streamCountBeforeRestore + 1);
    stop();
  });
});
