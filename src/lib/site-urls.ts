/**
 * Absolute addresses of public site pages, spelled the way the router
 * serves them (audit LD-03).
 *
 * Routing is `localePrefix: "as-needed"`: Russian, the default, lives at the
 * root and Uzbek under /uz. canonical, hreflang, og:url and the sitemap used
 * to say https://neurofax.uz/ru…, which next-intl answers with a 307 to the
 * unprefixed address, so search engines saw a redirecting canonical, filed
 * the Russian pages as «страница с переадресацией» and chose a canonical of
 * their own. The legal pages had no alternates at all and inherited the
 * landing's, declaring the landing their canonical page.
 *
 * Every public page builds its alternates here: canonical to itself, both
 * languages, x-default to the Russian page.
 */
import type { Metadata } from "next";

import { defaultLocale, locales } from "@/i18n/config";
import { SITE_DOMAIN } from "@/lib/constants";
import { siteHomePath } from "@/lib/site-nav";

const ORIGIN = `https://${SITE_DOMAIN}`;

/**
 * Path of `path` ("/", "/privacy", "/doctors/<id>") in `locale`:
 * "/privacy" for ru, "/uz/privacy" for uz.
 */
export function sitePath(locale: string, path: string): string {
  const home = siteHomePath(locale);
  if (path === "/" || path === "") return home;
  const rest = path.startsWith("/") ? path : `/${path}`;
  return home === "/" ? rest : `${home}${rest}`;
}

/** Absolute URL of `path` in `locale`, e.g. https://neurofax.uz/uz/privacy. */
export function siteUrl(locale: string, path: string): string {
  return `${ORIGIN}${sitePath(locale, path)}`;
}

/** hreflang map of `path`: every locale plus x-default (the default, ru). */
export function siteLanguages(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of locales) out[l] = siteUrl(l, path);
  out["x-default"] = siteUrl(defaultLocale, path);
  return out;
}

/** `alternates` of a public page: canonical to itself plus its languages. */
export function siteAlternates(
  locale: string,
  path: string,
): NonNullable<Metadata["alternates"]> {
  return { canonical: siteUrl(locale, path), languages: siteLanguages(path) };
}
