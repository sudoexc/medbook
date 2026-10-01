/**
 * Audit LD-05 + LD-03: the sitemap is built per request with the database,
 * lists every doctor the site shows in both languages, with each doctor's
 * own lastModified, and only addresses that answer 200 ("/", "/uz",
 * "/doctors/<id>", "/uz/doctors/<id>"), never "/ru…".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  pages: [] as Array<{ id: string; updatedAt: Date }>,
  pricesAt: null as Date | null,
}));

vi.mock("@/lib/doctors", () => ({
  getSiteDoctorPages: vi.fn(async () => h.pages),
}));
vi.mock("@/lib/site-prices", () => ({
  getSitePriceSheet: vi.fn(async () => ({ groups: {}, updatedAt: h.pricesAt })),
}));

import sitemap, { dynamic } from "@/app/sitemap";

beforeEach(() => {
  h.pages = [];
  h.pricesAt = null;
});

describe("sitemap.xml", () => {
  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("lists each listed doctor in both languages with his own lastModified", async () => {
    const a = new Date("2026-09-01T10:00:00Z");
    const b = new Date("2026-09-20T10:00:00Z");
    h.pages = [
      { id: "d1", updatedAt: a },
      { id: "d2", updatedAt: b },
    ];
    h.pricesAt = new Date("2026-08-01T00:00:00Z");
    const out = await sitemap();
    expect(out.map((e) => e.url)).toEqual([
      "https://neurofax.uz/",
      "https://neurofax.uz/uz",
      "https://neurofax.uz/doctors/d1",
      "https://neurofax.uz/uz/doctors/d1",
      "https://neurofax.uz/doctors/d2",
      "https://neurofax.uz/uz/doctors/d2",
    ]);
    expect(out.find((e) => e.url.endsWith("/doctors/d1"))!.lastModified).toEqual(a);
    expect(out.find((e) => e.url.endsWith("/uz/doctors/d2"))!.lastModified).toEqual(b);
    // The landing changed when its newest doctor or price did.
    expect(out[0]!.lastModified).toEqual(b);
    expect(out[0]!.alternates?.languages).toMatchObject({
      ru: "https://neurofax.uz/",
      uz: "https://neurofax.uz/uz",
    });
    expect(JSON.stringify(out)).not.toMatch(/neurofax\.uz\/ru/);
  });

  it("reports no landing date it does not have", async () => {
    const out = await sitemap();
    expect(out).toHaveLength(2);
    expect(out[0]!.lastModified).toBeUndefined();
  });
});
