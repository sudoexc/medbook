import type { MetadataRoute } from "next";
import { SITE_DOMAIN } from "@/lib/constants";

/**
 * The one robots.txt (audit LD-13). A public/robots.txt used to sit next to
 * this file, and Next serves the public folder first, so every edit here was
 * dead: crawlers kept reading the static copy, which listed a /dashboard/
 * that does not exist and none of the private paths below.
 *
 * Closed: the API, the staff surfaces (CRM, doctor's cabinet, admin, sign-in,
 * clinic sign-up) in both locales, the lobby screens, and the patient
 * capability links (Mini App /c/, live ticket /q/ and /ticket/, ticket short
 * link /t/, document check /v/). «/doctor» is closed as a whole segment
 * («/doctor/» and the bare «/doctor$»): a plain prefix would also close the
 * public «/doctors/<id>» pages.
 */
const ROBOTS_DISALLOW = [
  "/api/",
  "/crm",
  "/uz/crm",
  "/doctor/",
  "/doctor$",
  "/uz/doctor/",
  "/uz/doctor$",
  "/admin",
  "/login",
  "/signup",
  "/uz/signup",
  "/kiosk",
  "/tv",
  "/c/",
  "/q/",
  "/t/",
  "/v/",
  "/ticket/",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ROBOTS_DISALLOW,
    },
    sitemap: `https://${SITE_DOMAIN}/sitemap.xml`,
  };
}
