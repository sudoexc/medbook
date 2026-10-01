/**
 * The public site (audit LD-03, LD-04, LD-05, LD-08).
 *
 *   LD-03  canonical, hreflang, og:url and the sitemap said /ru…, which the
 *          router answers with a 307 to the unprefixed address; the legal
 *          pages inherited the landing's canonical.
 *   LD-04  /privacy and /terms were force-static: the booking form in their
 *          header kept the doctor list of the first render after a deploy.
 *   LD-05  the sitemap was prerendered by `next build` with no database:
 *          no doctor page ever reached it, lastModified = build time.
 *   LD-08  a doctor who left could not be taken off the site (no flag, and
 *          he cannot be deleted once he has history). Now `listedOnSite`,
 *          default true, switched in the doctor's card.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  doctorFindMany: [] as Array<Record<string, unknown>>,
  doctorFindFirst: [] as Array<Record<string, unknown>>,
  serviceFindMany: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ namespace }: { namespace: string }) => (k: string) => `${namespace}.${k}`,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findFirst: vi.fn(async () => ({ id: "c1" })) },
    doctor: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.doctorFindMany.push(args);
        return [];
      }),
      findFirst: vi.fn(async (args: Record<string, unknown>) => {
        h.doctorFindFirst.push(args);
        return null;
      }),
    },
    doctorSchedule: { findMany: vi.fn(async () => []) },
    service: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        h.serviceFindMany.push(args);
        return [];
      }),
    },
  },
}));

import { sitePath, siteAlternates, siteLanguages, siteUrl } from "@/lib/site-urls";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

beforeEach(() => {
  h.doctorFindMany = [];
  h.doctorFindFirst = [];
  h.serviceFindMany = [];
});

describe("LD-03: addresses as the router serves them", () => {
  it("ru has no prefix, uz has /uz", () => {
    expect(sitePath("ru", "/")).toBe("/");
    expect(sitePath("uz", "/")).toBe("/uz");
    expect(sitePath("ru", "/privacy")).toBe("/privacy");
    expect(sitePath("uz", "/doctors/abc")).toBe("/uz/doctors/abc");
    expect(siteUrl("ru", "/")).toBe("https://neurofax.uz/");
    expect(siteUrl("uz", "/terms")).toBe("https://neurofax.uz/uz/terms");
  });

  it("alternates: canonical to the page itself, both languages and x-default, never /ru", () => {
    expect(siteAlternates("uz", "/")).toEqual({
      canonical: "https://neurofax.uz/uz",
      languages: {
        ru: "https://neurofax.uz/",
        uz: "https://neurofax.uz/uz",
        "x-default": "https://neurofax.uz/",
      },
    });
    expect(JSON.stringify(siteLanguages("/doctors/d1"))).not.toMatch(/neurofax\.uz\/ru/);
  });

  it("the landing declares itself canonical", async () => {
    const { generateMetadata } = await import("@/app/[locale]/(site)/page");
    const m = await generateMetadata({ params: Promise.resolve({ locale: "ru" }) });
    expect(m.alternates?.canonical).toBe("https://neurofax.uz/");
    expect((m.openGraph as { url?: string }).url).toBe("https://neurofax.uz/");
  });

  it.each(["privacy", "terms"] as const)(
    "/%s declares its own canonical, not the landing's",
    async (page) => {
      const mod =
        page === "privacy"
          ? await import("@/app/[locale]/(site)/privacy/page")
          : await import("@/app/[locale]/(site)/terms/page");
      const m = await mod.generateMetadata({ params: Promise.resolve({ locale: "ru" }) });
      const alt = m.alternates as { canonical: string; languages: Record<string, string> };
      expect(alt.canonical).toBe(`https://neurofax.uz/${page}`);
      expect(alt.languages.uz).toBe(`https://neurofax.uz/uz/${page}`);
      expect((m.openGraph as { url?: string }).url).toBe(`https://neurofax.uz/${page}`);
    },
  );

  it("the locale layout no longer hands the landing's canonical to every page", async () => {
    const { generateMetadata } = await import("@/app/[locale]/layout");
    const m = await generateMetadata({ params: Promise.resolve({ locale: "uz" }) });
    expect(m.alternates).toBeUndefined();
    expect((m.openGraph as { url?: string }).url).toBeUndefined();
  });

  it("the doctor page builds its URLs with the helper", () => {
    const src = read("src/app/[locale]/(site)/doctors/[id]/page.tsx");
    expect(src).toMatch(/siteAlternates\(locale, `\/doctors\/\$\{id\}`\)/);
    expect(src).not.toMatch(/\$\{SITE_DOMAIN\}\/\$\{locale\}/);
    expect(src).not.toMatch(/href=\{`\/\$\{locale\}#doctors`\}/);
  });
});

describe("LD-04: the legal pages are rendered per request", () => {
  it.each(["privacy", "terms"])("/%s has no force-static override", (page) => {
    const src = read(`src/app/[locale]/(site)/${page}/page.tsx`);
    expect(src).not.toMatch(/export const dynamic\s*=/);
    expect(read("src/app/[locale]/(site)/layout.tsx")).toMatch(
      /export const dynamic = "force-dynamic"/,
    );
  });
});

describe("LD-08: only doctors switched on for the site", () => {
  it("getDoctors and getDoctorById filter by listedOnSite", async () => {
    const { getDoctors, getDoctorById } = await import("@/lib/doctors");
    await getDoctors();
    await getDoctorById("d1");
    expect(h.doctorFindMany[0]!.where).toEqual({ clinicId: "c1", listedOnSite: true });
    expect(h.doctorFindFirst[0]!.where).toEqual({ id: "d1", clinicId: "c1", listedOnSite: true });
  });

  it("an unlisted doctor's page is a 404 (getDoctorById returns null, the page calls notFound)", async () => {
    const { getDoctorById } = await import("@/lib/doctors");
    await expect(getDoctorById("gone")).resolves.toBeNull();
    expect(read("src/app/[locale]/(site)/doctors/[id]/page.tsx")).toMatch(
      /if \(!doctor\) notFound\(\);/,
    );
  });

  it("a price line naming an unlisted doctor drops off the sheet", async () => {
    const { getSitePriceSheet, invalidateSitePrices } = await import("@/lib/site-prices");
    invalidateSitePrices();
    await getSitePriceSheet();
    const select = h.serviceFindMany[0]!.select as { doctors: { where: unknown } };
    expect(select.doctors.where).toEqual({ doctor: { listedOnSite: true } });
  });

  it("a site request naming an unlisted doctor still lands, without the doctor", () => {
    const src = read("src/app/api/leads/route.ts");
    const lookup = src.slice(src.indexOf("prisma.doctor.findFirst({"));
    expect(lookup.slice(0, lookup.indexOf("select:"))).toMatch(/listedOnSite: true/);
  });

  it("the column defaults to true, so everyone the site showed stays on it", () => {
    expect(read("prisma/schema.prisma")).toMatch(/listedOnSite\s+Boolean\s+@default\(true\)/);
    expect(
      read("prisma/migrations/20261001320000_doctor_listed_on_site/migration.sql"),
    ).toMatch(/ADD COLUMN\s+"listedOnSite" BOOLEAN NOT NULL DEFAULT true/);
  });
});

describe("LD-05: the sitemap is built per request, with the doctor pages", () => {
  it("is force-dynamic", () => {
    expect(read("src/app/sitemap.ts")).toMatch(/export const dynamic = "force-dynamic"/);
  });
});
