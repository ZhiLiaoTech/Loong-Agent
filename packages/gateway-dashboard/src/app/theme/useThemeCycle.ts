import { useEffect, useState } from "react";
import { initTheme, readThemePreference, resolvedTheme, setThemePreference, type ThemePreference } from "../theme.js";

export function useThemeCycle() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference());
  const [theme, setTheme] = useState<"light" | "dark">(resolvedTheme());

  useEffect(() => {
    initTheme();
    setTheme(resolvedTheme());
    setPreference(readThemePreference());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMedia = () => {
      if (readThemePreference() === "system") {
        setTheme(resolvedTheme());
      }
    };
    media.addEventListener("change", onMedia);
    return () => media.removeEventListener("change", onMedia);
  }, []);

  function cycleTheme() {
    const order: ThemePreference[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(readThemePreference()) + 1) % order.length] ?? "system";
    setThemePreference(next);
    setPreference(next);
    setTheme(resolvedTheme());
  }

  return {
    cycleTheme,
    themeLabel: `Theme: ${preference} (${theme})`,
  };
}
