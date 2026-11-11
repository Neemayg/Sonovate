// Colour theme: the visitor's choice (Light, Dark or System) is stored in
// localStorage and applied as <html data-theme="light|dark">. Dark is the
// default identity. THEME_SCRIPT runs inline in <head> before first paint so
// the wrong theme never flashes; it also follows the system setting live
// while "System" is chosen.

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "sonovate-theme";
export const DEFAULT_THEME: ThemeChoice = "dark";
export const THEME_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];
export const THEME_EVENT = "sonovate-theme-change";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

// Self-contained (no imports): serialised into the page as a string.
function applyStoredTheme(key: string, fallback: string, eventName: string) {
  const root = document.documentElement;
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const read = () => {
    try {
      const v = localStorage.getItem(key);
      return v === "light" || v === "dark" || v === "system" ? v : fallback;
    } catch {
      return fallback;
    }
  };
  const apply = (animate: boolean) => {
    const choice = read();
    const resolved = choice === "system" ? (media.matches ? "light" : "dark") : choice;
    if (animate && root.dataset.theme !== resolved) {
      // Suspend transitions for two frames so every colour swaps together.
      root.classList.add("theme-changing");
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-changing")));
    }
    root.dataset.theme = resolved;
    root.dataset.themeChoice = choice;
    root.style.colorScheme = resolved;
  };
  apply(false);
  const update = () => apply(true);
  media.addEventListener("change", update);
  window.addEventListener(eventName, update);
  window.addEventListener("storage", (e) => {
    if (e.key === key) update();
  });
}

export const THEME_SCRIPT = `(${applyStoredTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)},${JSON.stringify(
  DEFAULT_THEME,
)},${JSON.stringify(THEME_EVENT)});`;

export function readThemeChoice(): ThemeChoice {
  const value = typeof document === "undefined" ? null : document.documentElement.dataset.themeChoice;
  return isThemeChoice(value) ? value : DEFAULT_THEME;
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
    window.dispatchEvent(new Event(THEME_EVENT));
  } catch {
    // Storage blocked (private mode): apply to this page only.
    const root = document.documentElement;
    const resolved =
      choice === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
    root.classList.add("theme-changing");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-changing")));
    root.dataset.themeChoice = choice;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  }
}

// Re-render subscribers whenever the applied theme attributes change.
export function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-choice"] });
  return () => observer.disconnect();
}
