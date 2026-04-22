import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "./config";

/**
 * Routing config for next-intl.
 *
 * `localePrefix: 'as-needed'` means the default locale (ru) is served from the
 * root (no `/ru` prefix), while the alternative locale (uz) is served under
 * `/uz`. This matches TZ §9.4: ru default, uz alternative, clean URLs.
 *
 * Hreflang alternates are emitted in the root layout metadata.
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
});
