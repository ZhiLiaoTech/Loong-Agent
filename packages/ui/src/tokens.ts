/**
 * Loong design tokens (visual language aligned with ClawWorks).
 */

export type ThemeMode = "dark" | "light";

export const THEME_STORAGE_KEY = "loong.theme";
export const THEME_CHANGE_EVENT = "loong:theme-change";

export interface ThemeColors {
  bg: string;
  surface1: string;
  surface2: string;
  surface3: string;
  card: string;
  border: string;
  borderLight: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  accent: string;
  accentLight: string;
  accentGlow: string;
  success: string;
  warning: string;
  error: string;
}

const darkTheme: ThemeColors = {
  bg: "#08080D",
  surface1: "#101018",
  surface2: "#16161F",
  surface3: "#1C1C28",
  card: "#13131C",
  border: "#232333",
  borderLight: "#2E2E40",
  text: "#EAEAF2",
  textSecondary: "#A0A0B8",
  textTertiary: "#6A6A82",
  textMuted: "#4A4A60",
  accent: "#7C6CF0",
  accentLight: "#A89EFF",
  accentGlow: "rgba(124,108,240,0.12)",
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
} as const;

const lightTheme: ThemeColors = {
  bg: "#F6F7FB",
  surface1: "#FFFFFF",
  surface2: "#F1F3F8",
  surface3: "#E7EAF2",
  card: "#FFFFFF",
  border: "#DDE2EE",
  borderLight: "#C8D0E0",
  text: "#151827",
  textSecondary: "#475067",
  textTertiary: "#758096",
  textMuted: "#9AA3B5",
  accent: "#6D5BEF",
  accentLight: "#7568F5",
  accentGlow: "rgba(109,91,239,0.12)",
  success: "#059669",
  warning: "#D97706",
  error: "#DC2626",
};

const themes: Record<ThemeMode, ThemeColors> = {
  dark: darkTheme,
  light: lightTheme,
};

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" ? "light" : "dark";
}

function readStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  try {
    return normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export const theme = { ...themes[readStoredThemeMode()] };

export function getThemeMode(): ThemeMode {
  return readStoredThemeMode();
}

export function applyThemeMode(mode: ThemeMode, persist = true): ThemeMode {
  const nextMode = normalizeThemeMode(mode);
  Object.assign(theme, themes[nextMode]);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = nextMode;
    document.documentElement.style.colorScheme = nextMode;
    document.body.style.background = theme.bg;
    document.body.style.color = theme.text;
  }
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    } catch {
      // ignore
    }
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { mode: nextMode } }));
  }
  return nextMode;
}

if (typeof document !== "undefined") {
  applyThemeMode(readStoredThemeMode(), false);
}

export const fonts = {
  sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei UI', sans-serif",
  display: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Consolas, monospace",
} as const;

export type Theme = ThemeColors;
