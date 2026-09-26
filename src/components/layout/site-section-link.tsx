"use client";

import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { siteSectionHref, type SiteSection } from "@/lib/site-nav";

/** Whether the current page is the landing (any locale), where the sections live. */
export function useOnSiteHome(): boolean {
  // next-intl's pathname has the locale prefix stripped: "/" on both / and /uz.
  return usePathname() === "/";
}

/**
 * A plain anchor to a landing section that works from any site page: a
 * same-page jump on the landing, the landing plus the hash elsewhere (see
 * siteSectionHref). A plain <a>, not a router Link, so the browser itself
 * scrolls to the section once the landing has loaded.
 */
export function SiteSectionLink({
  section,
  ...props
}: Omit<React.ComponentProps<"a">, "href"> & { section: SiteSection }) {
  const locale = useLocale();
  const onHome = useOnSiteHome();
  return <a href={siteSectionHref(section, locale, onHome)} {...props} />;
}
