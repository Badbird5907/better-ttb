import { Monitor, Moon, Sun } from "lucide-react";
import * as React from "react";

import {
  THEME_STORAGE_KEY,
  applyTheme,
  isTheme,
  readStoredTheme,
  resolveTheme,
  type Theme,
} from "@/lib/theme";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const THEME_ORDER: Theme[] = ["light", "dark", "system"];
const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/**
 * Reads and persists the theme in localStorage, applies the html class, and
 * keeps the resolved theme in sync when following the system preference.
 */
export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme) => void;
} {
  const [theme, setThemeState] = React.useState<Theme>("system");

  React.useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  // Follow theme changes made in other tabs; the storage event only fires in
  // tabs that did not perform the write.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) {
        return;
      }

      setThemeState(isTheme(event.newValue) ? event.newValue : "system");
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  React.useEffect(() => {
    applyTheme(theme);

    if (theme !== "system" || typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, []);

  return { theme, setTheme };
}

/**
 * Tracks the resolved (light | dark) theme by observing the html `dark` class,
 * so consumers react to both explicit toggles and system-preference changes.
 */
export function useResolvedTheme(): "light" | "dark" {
  const [resolved, setResolved] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setResolved(root.classList.contains("dark") ? "dark" : "light");

    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return resolved;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const resolved = resolveTheme(theme);
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? "system";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => setTheme(nextTheme)}
          >
            {theme === "system" ? (
              <Monitor />
            ) : resolved === "dark" ? (
              <Moon />
            ) : (
              <Sun />
            )}
            <span className="sr-only">
              Theme: {THEME_LABELS[theme]}. Switch to {THEME_LABELS[nextTheme]}.
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Theme: {THEME_LABELS[theme]}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
