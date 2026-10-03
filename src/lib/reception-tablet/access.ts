/**
 * Who works the reception tablet (`/crm/reception/tablet`), and the web app
 * manifest that lets «Добавить на экран Домой» open it full screen.
 *
 * Pure: the page, the manifest route and the unit tests share it.
 */

/** The desk and the clinic's administrators; a SUPER_ADMIN visiting a clinic. */
export const RECEPTION_TABLET_ROLES = ["RECEPTIONIST", "ADMIN", "SUPER_ADMIN"] as const;

export function canUseReceptionTablet(role: string | null | undefined): boolean {
  return (RECEPTION_TABLET_ROLES as readonly string[]).includes(role ?? "");
}

/** The page under the locale prefix (ru is served without one). */
export function receptionTabletPath(locale: string): string {
  return locale === "uz" ? "/uz/crm/reception/tablet" : "/crm/reception/tablet";
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
