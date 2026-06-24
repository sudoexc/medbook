"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Globe, Check } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

type Lang = "ru" | "uz";

const LABELS: Record<Lang, { short: string; long: string }> = {
  ru: { short: "Рус", long: "Русский" },
  uz: { short: "O'z", long: "O'zbekcha" },
};

/**
 * Dropdown switcher for UI language (ru ↔ uz).
 *
 * - Updates the route via next-intl's `useRouter` (which re-renders the tree
 *   and writes the `NEXT_LOCALE` cookie so subsequent visits stick).
 * - Also writes the cookie defensively (1-year, path=/) in case cookie
 *   propagation lags the client-side navigation.
 * - For authenticated staff it also PATCHes `/api/me { locale }` (best-effort)
 *   so the choice is persisted server-side and survives across devices — the
 *   cookie alone is per-browser. Unauthenticated callers (public pages) get a
 *   harmless 401 which we ignore.
 */
export function LanguageSwitcher() {
  const locale = useLocale() as Lang;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switchTo = useCallback(
    (next: Lang) => {
      if (next === locale) {
        setOpen(false);
        return;
      }
      // Persist for future visits. next-intl also sets this cookie on navigation
      // but we write it eagerly so the preference survives before the nav resolves.
      document.cookie = `NEXT_LOCALE=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;

      // Persist the staff preference server-side so it survives across devices
      // (the cookie is per-browser). Best-effort: a 401 on public pages or a
      // transient failure must not block the language change.
      void fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => {});

      router.replace(pathname, { locale: next });
      setOpen(false);
    },
    [locale, router, pathname],
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Change language"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Globe className="h-4 w-4 text-muted-foreground" />
        <span>{LABELS[locale].short}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-background py-1 shadow-md"
        >
          {(Object.keys(LABELS) as Lang[]).map((lang) => (
            <button
              key={lang}
              type="button"
              role="menuitemradio"
              aria-checked={lang === locale}
              onClick={() => switchTo(lang)}
              className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
            >
              <span>{LABELS[lang].long}</span>
              {lang === locale && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
