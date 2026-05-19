export type ThemePreference = "light" | "dark" | "system";

export function readThemePreference(): ThemePreference {
  const value = document.documentElement.dataset.themePreference;
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}

/** Persist preference on document only (no localStorage — test-suite constraint). */
export function setThemePreference(preference: ThemePreference): void {
  document.documentElement.dataset.themePreference = preference;
  applyThemePreference(preference);
}

export function applyThemePreference(preference: ThemePreference = readThemePreference()): void {
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
    return;
  }
  document.documentElement.dataset.theme = preference;
}

export function initTheme(): void {
  const boot = document.documentElement.dataset.themePreference as ThemePreference | undefined;
  applyThemePreference(boot ?? "system");
}

export function resolvedTheme(): "light" | "dark" {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") {
    return explicit;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
