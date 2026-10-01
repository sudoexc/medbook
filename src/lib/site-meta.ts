/**
 * Title, description and Open Graph block of the public site, shared by the
 * locale layout and the public pages (audit LD-03).
 *
 * Next merges metadata shallowly: a page that sets `openGraph` replaces the
 * layout's whole block. Each public page sets its own `og:url` (its own
 * address, not the landing's), so the rest of the block comes from here to
 * stay identical everywhere.
 */
import type { Metadata } from "next";

import { SITE_NAME } from "@/lib/constants";
import { siteUrl } from "@/lib/site-urls";

const META: Record<string, { title: string; description: string }> = {
  ru: {
    title: `${SITE_NAME} — Медицинский центр неврологии и кардиологии в Ташкенте`,
    description:
      "Медицинский центр NeuroFax — неврология, кардиология, УЗИ-диагностика в Ташкенте. Опытные специалисты, современное оборудование.",
  },
  uz: {
    title: `${SITE_NAME} — Toshkentda nevrologiya va kardiologiya tibbiyot markazi`,
    description:
      "NeuroFax tibbiyot markazi — nevrologiya, kardiologiya, UZI diagnostikasi Toshkentda. Tajribali mutaxassislar, zamonaviy uskunalar.",
  },
};

/** The landing's title and description in `locale` (ru for anything else). */
export function siteMeta(locale: string): { title: string; description: string } {
  return META[locale] ?? META.ru!;
}

/**
 * Open Graph block of a public page. Without `path` it carries no `og:url`:
 * that is the layout's default, inherited by pages that are not part of the
 * public site.
 */
export function siteOpenGraph(
  locale: string,
  path?: string,
  overrides: { title?: string; description?: string } = {},
): NonNullable<Metadata["openGraph"]> {
  const m = siteMeta(locale);
  return {
    title: overrides.title ?? m.title,
    description: overrides.description ?? m.description,
    ...(path !== undefined ? { url: siteUrl(locale, path) } : {}),
    siteName: SITE_NAME,
    locale: locale === "uz" ? "uz_UZ" : "ru_RU",
    type: "website",
  };
}
