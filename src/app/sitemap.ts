import type { MetadataRoute } from "next";
import { SITE_DOMAIN } from "@/lib/constants";
import { getDoctors } from "@/lib/doctors";
import { locales } from "@/i18n/config";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = `https://${SITE_DOMAIN}`;
  const doctors = await getDoctors();

  const pages: MetadataRoute.Sitemap = locales.map((locale) => ({
    url: `${baseUrl}/${locale}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 1,
  }));

  for (const doc of doctors) {
    for (const locale of locales) {
      pages.push({
        url: `${baseUrl}/${locale}/doctors/${doc.id}`,
        lastModified: new Date(),
        changeFrequency: "monthly" as const,
        priority: 0.8,
      });
    }
  }

  return pages;
}
