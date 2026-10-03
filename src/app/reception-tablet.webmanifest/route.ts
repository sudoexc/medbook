/**
 * GET /reception-tablet.webmanifest?lang=ru|uz — the web app manifest of the
 * reception tablet page (`/crm/reception/tablet`), linked from that page
 * only, so «Добавить на экран Домой» on the clinic's iPad opens the tablet
 * page full screen and the rest of the CRM keeps behaving like a website.
 *
 * Public on purpose: Safari fetches a manifest without credentials, and it
 * holds nothing but names, colours and icon paths. The dot in the path keeps
 * it out of the auth proxy and the locale middleware (see src/proxy.ts).
 */
import { buildReceptionTabletManifest } from "@/lib/reception-tablet/access";

export function GET(request: Request): Response {
  const lang = new URL(request.url).searchParams.get("lang");
  return new Response(JSON.stringify(buildReceptionTabletManifest(lang)), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
