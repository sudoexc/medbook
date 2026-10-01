import type { MetadataRoute } from "next";

import { locales } from "@/i18n/config";
import { getSiteDoctorPages } from "@/lib/doctors";
import { getSitePriceSheet } from "@/lib/site-prices";
import { siteLanguages, siteUrl } from "@/lib/site-urls";

// Built per request, with the database (audit LD-05). Without this the
// sitemap was prerendered by `next build` inside the Docker builder, where
// no database exists: production served the two landing URLs only, never a
// doctor page, with lastModified frozen at the build time.
export const dynamic = "force-dynamic";

function latest(dates: Array<Date | null | undefined>): Date | undefined {
  let out: Date | undefined;
  for (const d of dates) if (d && (!out || d > out)) out = d;
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [doctors, prices] = await Promise.all([
    getSiteDoctorPages(),
    getSitePriceSheet(),
  ]);

  // The landing changes with the doctors it lists and the prices it shows;
  // nothing else on it has a date we could honestly report.
  const homeModified = latest([...doctors.map((d) => d.updatedAt), prices.updatedAt]);

  // Addresses as the router serves them ("/", "/uz", "/doctors/<id>"), never
  // "/ru…", which redirects (audit LD-03).
  const pages: MetadataRoute.Sitemap = locales.map((locale) => ({
    url: siteUrl(locale, "/"),
    ...(homeModified ? { lastModified: homeModified } : {}),
    changeFrequency: "weekly" as const,
    priority: 1,
    alternates: { languages: siteLanguages("/") },
  }));

  for (const doc of doctors) {
    const path = `/doctors/${doc.id}`;
    for (const locale of locales) {
      pages.push({
        url: siteUrl(locale, path),
        lastModified: doc.updatedAt,
        changeFrequency: "monthly" as const,
        priority: 0.8,
        alternates: { languages: siteLanguages(path) },
      });
    }
  }

  return pages;
}
