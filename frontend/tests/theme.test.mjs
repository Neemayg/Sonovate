import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THEME, isThemeChoice, THEME_EVENT, THEME_SCRIPT, THEME_STORAGE_KEY } from "../src/lib/theme.ts";

// Runs the inline head script against a minimal fake browser.
function run({ stored, systemLight = false, storageThrows = false }) {
  const listeners = {};
  const mediaListeners = [];
  const store = new Map(stored === undefined ? [] : [[THEME_STORAGE_KEY, stored]]);
  const root = { dataset: {}, style: {}, classList: { add() {}, remove() {} } };
  const media = { matches: systemLight, addEventListener: (_, fn) => mediaListeners.push(fn) };
  const sandbox = {
    document: { documentElement: root },
    window: {
      matchMedia: () => media,
      addEventListener: (name, fn) => ((listeners[name] ??= []).push(fn)),
    },
    localStorage: {
      getItem: (k) => {
        if (storageThrows) throw new Error("blocked");
        return store.get(k) ?? null;
      },
    },
    requestAnimationFrame: (fn) => fn(),
  };
  new Function(...Object.keys(sandbox), THEME_SCRIPT)(...Object.values(sandbox));
  return { root, store, media, fire: (name) => listeners[name]?.forEach((fn) => fn({ key: THEME_STORAGE_KEY })), mediaChange: () => mediaListeners.forEach((fn) => fn()) };
}

test("dark is the default identity", () => {
  assert.equal(DEFAULT_THEME, "dark");
  const { root } = run({ stored: undefined, systemLight: true });
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.dataset.themeChoice, "dark");
  assert.equal(root.style.colorScheme, "dark");
});

test("a stored choice is applied before paint", () => {
  assert.equal(run({ stored: "light" }).root.dataset.theme, "light");
  assert.equal(run({ stored: "dark", systemLight: true }).root.dataset.theme, "dark");
});

test("system follows the device and its live changes", () => {
  const env = run({ stored: "system", systemLight: false });
  assert.equal(env.root.dataset.theme, "dark");
  assert.equal(env.root.dataset.themeChoice, "system");
  env.media.matches = true;
  env.mediaChange();
  assert.equal(env.root.dataset.theme, "light");
});

test("invalid or unreadable storage falls back to dark", () => {
  assert.equal(run({ stored: "purple" }).root.dataset.theme, "dark");
  assert.equal(run({ stored: "light", storageThrows: true }).root.dataset.theme, "dark");
});

test("a change event re-applies the stored choice", () => {
  const env = run({ stored: "dark" });
  env.store.set(THEME_STORAGE_KEY, "light");
  env.fire(THEME_EVENT);
  assert.equal(env.root.dataset.theme, "light");
});

test("choice validation", () => {
  for (const ok of ["light", "dark", "system"]) assert.ok(isThemeChoice(ok));
  for (const bad of ["", "auto", null, undefined, 1]) assert.ok(!isThemeChoice(bad));
});
