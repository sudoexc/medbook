import type { MetadataRoute } from "next";
import { SITE_DOMAIN } from "@/lib/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard/",
        "/receptionist",
        "/kiosk",
        "/tv",
        "/login",
        "/ticket/",
        "/q/",
      ],
    },
    sitemap: `https://${SITE_DOMAIN}/sitemap.xml`,
  };
}
