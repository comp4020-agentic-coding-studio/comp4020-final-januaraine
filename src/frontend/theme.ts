// Page-chrome theme, now including the game canvas: toggling this dispatches
// a "themechange" event on `window` so room-client.ts (and anything else
// drawing a canvas) can redraw immediately against the new palette, rather
// than waiting for its next natural redraw. See arena-render.ts's
// readPalette(), which reads the CSS custom properties this file's sibling
// styles.css defines per theme — colors live in one place (CSS), not
// duplicated here or in JS.

const STORAGE_KEY = "theme";

type Theme = "dark" | "light";

function isTheme(value: string | null): value is Theme {
  return value === "dark" || value === "light";
}

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : null;
  } catch {
    // Storage disabled (e.g. private browsing): fall through to the default.
    return null;
  }
}

function applyTheme(theme: Theme): void {
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
}

// The label still names the mode a click switches *to* ("Light mode" shown
// while currently dark) — the icon follows the same convention (a sun for
// "switch to light", a moon for "switch to dark"), so the two always agree.
function labelFor(theme: Theme): string {
  return theme === "light" ? "Dark mode" : "Light mode";
}

function iconFor(theme: Theme): string {
  return theme === "light" ? "☀" : "☾"; // ☀ / ☾
}

// Builds the icon/label spans once (so a page's markup only ever needs the
// plain `<button class="theme-toggle" data-action="toggle-theme">` — no
// per-page markup duplication) and keeps both in sync on every toggle. This
// is also what keeps the button's rendered width identical in either state
// (see styles.css's `.theme-toggle`/`.theme-toggle-icon`): the DOM structure
// never changes shape, only these two spans' text content does.
function render(icon: HTMLElement, label: HTMLElement, theme: Theme): void {
  icon.textContent = iconFor(theme);
  label.textContent = labelFor(theme);
}

export function initThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-action="toggle-theme"]');
  if (!button) return;

  let icon = button.querySelector<HTMLElement>(".theme-toggle-icon");
  let label = button.querySelector<HTMLElement>(".theme-toggle-label");
  if (!icon || !label) {
    button.textContent = "";
    icon = document.createElement("span");
    icon.className = "theme-toggle-icon";
    icon.setAttribute("aria-hidden", "true");
    label = document.createElement("span");
    label.className = "theme-toggle-label";
    button.append(icon, label);
  }

  let theme: Theme = readStoredTheme() ?? "dark";
  applyTheme(theme);
  render(icon, label, theme);

  button.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    applyTheme(theme);
    render(icon!, label!, theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme still applies for this page load; it just won't persist.
    }
    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  });
}
