"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Globe, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";

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
 * - For authenticated staff, we'd like to persist `user.locale` server-side so
 *   notifications go out in the right language. That requires `/api/me`
 *   (PATCH { locale }) which doesn't exist yet — see TODO below.
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

  function switchTo(next: Lang) {
    if (next === locale) {
      setOpen(false);
      return;
    }
    // Persist for future visits. next-intl also sets this cookie on navigation
    // but we write it eagerly so the preference survives before the nav resolves.
    document.cookie = `NEXT_LOCALE=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;

    // TODO(auth): once `/api/me` lands, PATCH { locale: next } so staff users'
    // `User.locale` is updated server-side and notifications go out in the
    // chosen language. For now we only persist via cookie.
    // fetch("/api/me", { method: "PATCH", body: JSON.stringify({ locale: next }) });

    router.replace(pathname, { locale: next });
    setOpen(false);
  }

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
