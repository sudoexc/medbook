/**
 * Who works the reception tablet (`/crm/reception/tablet`), and the web app
 * manifest that lets «Добавить на экран Домой» open it full screen.
 *
 * Pure: the page, the manifest route and the unit tests share it.
 */
import { startPageFor } from "@/lib/start-page";

/**
 * Only the clinic's iPad accounts: a reception account whose start page is
 * the tablet (src/lib/start-page.ts). Owner request 05.10.2026: opened from
 * a desk computer the tablet screen only confuses, so every other account,
 * administrators included, neither sees it in the menu nor opens it. A
 * second iPad gets it the same way, via the start page in the user settings.
 */
export function canUseReceptionTablet(
  role: string | null | undefined,
  startPage: unknown,
): boolean {
  return startPageFor(role, startPage) === "reception-tablet";
}

/** The page under the locale prefix (ru is served without one). */
export function receptionTabletPath(locale: string): string {
  return locale === "uz" ? "/uz/crm/reception/tablet" : "/crm/reception/tablet";
}

/**
 * Whether a pathname is the tablet page, with or without the locale prefix
 * (`next/navigation` gives «/uz/crm/reception/tablet», the i18n router
 * «/crm/reception/tablet»), a trailing slash or a query string.
 *
 * WHY: the CRM's shell alerts (a Telegram message, a site request, a Mini
 * App check-in) are global toasts with small «Открыть» buttons that leave
 * the page. On the iPad page they must speak its size and never navigate
 * the receptionist away from a patient half way through a booking.
 */
export function isReceptionTabletPath(pathname: string | null | undefined): boolean {
  const path = (pathname ?? "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  return /^(?:\/(?:ru|uz))?\/crm\/reception\/tablet$/.test(path);
}

/** Where the manifest is served; the language picks the start page. */
export function receptionTabletManifestUrl(locale: string): string {
  return `/reception-tablet.webmanifest?lang=${locale === "uz" ? "uz" : "ru"}`;
}

export type WebAppManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: "standalone" | "fullscreen";
  orientation: "any";
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
};

const NAMES = {
  ru: {
    name: "NeuroFax Ресепшн",
    short: "Ресепшн",
    description: "Очередь и запись пациентов с планшета",
  },
  uz: {
    name: "NeuroFax Qabulxona",
    short: "Qabulxona",
    description: "Planshetdan bemorlarni navbatga qo'yish va yozish",
  },
} as const;

/**
 * The manifest of the tablet page. The home screen icon opens the page
 * itself, standalone (no Safari bars); the scope is the whole site so a
 * sign-in after the session ends stays inside the same full screen window.
 */
export function buildReceptionTabletManifest(lang: string | null | undefined): WebAppManifest {
  const locale = lang === "uz" ? "uz" : "ru";
  const n = NAMES[locale];
  const start = receptionTabletPath(locale);
  return {
    id: start,
    name: n.name,
    short_name: n.short,
    description: n.description,
    lang: locale,
    start_url: start,
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4f6fa",
    theme_color: "#f4f6fa",
    icons: [
      { src: "/reception-tablet/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/reception-tablet/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/reception-tablet/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
