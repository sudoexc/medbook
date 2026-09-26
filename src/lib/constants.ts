export const SITE_NAME = "NeuroFax";
export const SITE_DOMAIN = "neurofax.uz";

/**
 * Clinic slug used by the global public surfaces (`/tv`, `/kiosk`) to reach the
 * slug-scoped `/api/c/[slug]/queue/*` endpoints. These screens are physically
 * installed in one clinic, so they default to that clinic; a `?c=<slug>` query
 * param overrides it (and Wave 6 will move this to per-device config). Prod is
 * currently single-tenant (neurofax), hence the hardcoded fallback.
 */
export const DEFAULT_CLINIC_SLUG =
  process.env.NEXT_PUBLIC_DEFAULT_CLINIC_SLUG ?? "neurofax";

export const CONTACT = {
  phone: "+998 71 275 28 18",
  email: "info@neurofax.uz",
  telegram: "#",
  instagram: "#",
  address: {
    ru: "Ташкент, 13 квартал, ул. Лутфий 26-1, 100138",
    uz: "Toshkent, 13-mavze, Lutfiy ko'chasi 26-1, 100138",
  },
} as const;

// The clinic's public Yandex Maps organisation — reviews link + map widget.
// One place, so the hero trust line, reviews section and directions map can
// never drift apart.
export const YANDEX_ORG_ID = "85279497169";
export const YANDEX_REVIEWS_URL =
  `https://yandex.uz/maps/org/neyrofaks_b/${YANDEX_ORG_ID}/reviews/`;
export const YANDEX_MAP_WIDGET_URL =
  `https://yandex.uz/map-widget/v1/?ol=biz&oid=${YANDEX_ORG_ID}&z=16`;
// The org's own pin on Yandex Maps («Neurofax-B», 13-mavze, 26), taken from
// its org card 25.09.2026. `rtext=~point` opens Yandex Maps (the app on a
// phone) with a ready route from wherever the patient stands to the door.
const CLINIC_POINT = "41.289885,69.189624";
export const YANDEX_ROUTE_URL =
  `https://yandex.uz/maps/?rtext=~${encodeURIComponent(CLINIC_POINT)}&rtt=auto`;

// The landing sections the site menu points at (header, mobile sheet,
// footer), by the id of their <section>. No href here on purpose: a bare
// "#doctors" only works on the landing itself, and the menu is on every
// site page (a doctor's page, the privacy policy), so the link is built per
// page and locale by siteSectionHref (audit CM-14).
export const NAV_LINKS = [
  { section: "doctors", labelKey: "nav.doctors" },
  { section: "services", labelKey: "nav.services" },
  { section: "visit", labelKey: "nav.visit" },
  { section: "faq", labelKey: "nav.faq" },
] as const;
