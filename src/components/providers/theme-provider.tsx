"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { staffThemeApplies } from "@/lib/theme-scope";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const STORAGE_KEY = "theme";
const MEDIA = "(prefers-color-scheme: dark)";

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function readSystem(): ResolvedTheme {
  return window.matchMedia(MEDIA).matches ? "dark" : "light";
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "light";
}

function applyClass(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

/**
 * Minimal replacement for `next-themes`. We roll our own because
 * `next-themes` renders a `<script>` element inside the React tree to
 * prevent FOUC, which triggers a React 19 warning ("Scripts inside React
 * components are never executed when rendering on the client").
 *
 * The FOUC script (THEME_INIT_SCRIPT, rendered by `app/layout.tsx`) runs
 * once before hydration to set the right `dark` class on `<html>`. After
 * hydration, this provider takes over: it reads localStorage, listens to
 * system preference changes, and re-applies the resolved class on toggle.
 *
 * The choice is the staff's and applies on staff surfaces only; every other
 * page (the public site, tickets, sign-up) is painted light whatever is
 * stored (audit LD-17). `resolvedTheme` is the theme actually painted.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("light");
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>("light");

  // Hydrate from localStorage + matchMedia after mount. SSR renders with
  // defaults; the FOUC script in <head> already painted the correct class.
  React.useEffect(() => {
    setThemeState(readStored());
    setSystemTheme(readSystem());
    const mq = window.matchMedia(MEDIA);
    const onChange = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const pathname = usePathname();
  const chosen: ResolvedTheme = theme === "system" ? systemTheme : theme;
  const resolvedTheme: ResolvedTheme = staffThemeApplies(pathname)
    ? chosen
    : "light";

  // Re-apply the class whenever the resolved value changes. This handles
  // user toggles, OS dark-mode changes, storage events from other tabs, and
  // navigation between a staff surface and the public site.
  React.useEffect(() => {
    applyClass(resolvedTheme);
  }, [resolvedTheme]);

  // Cross-tab sync: another tab toggling the theme should update this one.
  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setThemeState(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) {
    // Outside provider — return a safe stub so hooks called in tests / Storybook don't crash.
    return {
      theme: "system",
      resolvedTheme: "light",
      setTheme: () => {},
    };
  }
  return ctx;
}
