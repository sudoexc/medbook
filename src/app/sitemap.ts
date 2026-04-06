import type { MetadataRoute } from "next";
import { SITE_DOMAIN } from "@/lib/constants";
import { locales } from "@/i18n/config";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = `https://${SITE_DOMAIN}`;

  return locales.map((locale) => ({
    url: `${baseUrl}/${locale}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 1,
  }));
}
