/**
 * Links from the public site menu to the sections of the landing page.
 *
 * The menu (header, mobile sheet, footer) is part of the site layout, so it
 * is on every public page, while the sections it points at (#doctors,
 * #services…) exist only on the landing. Its links used to be bare hashes:
 * on a doctor's page or the privacy policy «Врачи» did nothing at all
 * (audit CM-14). The sections carry `scroll-mt-20` (the sticky header's
 * height), so a jump does not hide the section title under the header.
 */
import { defaultLocale } from "@/i18n/config";
import type { NAV_LINKS } from "@/lib/constants";

export type SiteSection = (typeof NAV_LINKS)[number]["section"];

/**
 * The landing page of a locale, spelled the way the router serves it
 * (`localePrefix: "as-needed"`): the default ru at "/", uz at "/uz". A
 * "/ru" link would cost a redirect on every tap.
 */
export function siteHomePath(locale: string): string {
  return locale === defaultLocale ? "/" : `/${locale}`;
}

/**
 * Where a menu item for a landing section points.
 *
 * On the landing itself it stays a bare "#doctors": a same-page jump that
 * keeps the query string, so a visitor who came in on an ad link with utm
 * tags does not reload the page (and lose them) by tapping the menu.
 * Anywhere else it is the landing of the current locale plus the hash, so
 * an uz visitor lands on /uz, not on the ru page.
 */
export function siteSectionHref(
  section: SiteSection,
  locale: string,
  onHome: boolean,
): string {
  return onHome ? `#${section}` : `${siteHomePath(locale)}#${section}`;
}
