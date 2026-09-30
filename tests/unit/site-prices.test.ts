import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

/**
 * Audit LD-07: the landing price list was strings in the message files
 * («300 000»), tied to nothing. An admin raising a price in the CRM left the
 * site months behind the desk. The sheet now takes its numbers from the
 * catalog (`Service.priceBase`, a doctor's own `priceOverride`), the message
 * files keep only the wording, and an edit in the CRM shows on the next page
 * load.
 */

const state = vi.hoisted(() => ({
  services: [] as Array<Record<string, unknown>>,
  serviceQueries: 0,
  locale: "ru" as "ru" | "uz",
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: { findFirst: vi.fn(async () => ({ id: "clinic_nf" })) },
    service: {
      findMany: vi.fn(async () => {
        state.serviceQueries += 1;
        return state.services;
      }),
    },
  },
}));
vi.mock("next-intl", () => {
  const lookup = (obj: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
  return {
    useLocale: () => state.locale,
    useTranslations: (ns: string) => {
      const msgs = () => (state.locale === "uz" ? uz : ru) as unknown as Record<string, unknown>;
      const t = (key: string, values?: Record<string, string>) => {
        let s = String(lookup(msgs(), `${ns}.${key}`));
        for (const [k, v] of Object.entries(values ?? {})) s = s.replace(`{${k}}`, v);
        return s;
      };
      t.raw = (key: string) => lookup(msgs(), `${ns}.${key}`);
      return t;
    },
  };
});

import {
  PRICE_GROUPS,
  PRICE_SHEET,
  formatSumAmount,
  getSitePriceSheet,
  invalidateSitePrices,
  resolvePriceSheet,
  type CatalogService,
} from "@/lib/site-prices";
import { formatMoney } from "@/lib/format";
import { Services } from "@/components/sections/services";

const SUM = (n: number) => n * 100;
const UPDATED = new Date("2026-09-20T07:00:00.000Z");

function svc(code: string, price: number, extra: Partial<CatalogService> = {}): CatalogService {
  return { code, priceBase: SUM(price), isActive: true, updatedAt: UPDATED, doctors: [], ...extra };
}

/** The clinic's catalog as seeded from the 18.05.2026 sheet. */
function catalog(): CatalogService[] {
  return [
    svc("KONS_NEURO_ADULT", 200_000, {
      doctors: [
        { doctorSlug: "busakov-bahtiyar", priceOverride: SUM(300_000) },
        { doctorSlug: "sultanov-aziz", priceOverride: null },
      ],
    }),
    svc("KONS_PED_NEURO", 200_000),
    svc("KONS_KARDIO", 200_000),
    svc("EEG", 150_000),
    svc("EEG_30", 200_000),
    svc("EEG_60", 300_000),
    svc("REO_EG", 100_000),
    svc("EHO_EG", 50_000),
    svc("EKG", 70_000),
    svc("EHO_KG", 150_000),
    svc("DOPPLER_BCA", 150_000),
    svc("UZI_ORGAN", 80_000),
    svc("NSG", 80_000),
  ];
}

function toDbRows(list: CatalogService[]) {
  return list.map((s) => ({
    code: s.code,
    priceBase: s.priceBase,
    isActive: s.isActive,
    updatedAt: s.updatedAt,
    doctors: s.doctors.map((d) => ({
      priceOverride: d.priceOverride,
      doctor: { slug: d.doctorSlug },
    })),
  }));
}

beforeEach(() => {
  state.services = toDbRows(catalog());
  state.serviceQueries = 0;
  state.locale = "ru";
  invalidateSitePrices();
});

describe("the public price sheet is priced from the CRM catalog (audit LD-07)", () => {
  it("15 000 000 tiyin reads «150 000 сум», the digits formatMoney prints", () => {
    expect(formatSumAmount(15_000_000)).toBe("150 000");
    expect(`${formatSumAmount(15_000_000)} сум`).toBe(formatMoney(15_000_000, "UZS", "ru"));
    expect(formatSumAmount(SUM(1_500_000))).toBe("1 500 000");
  });

  it("prices every printed line, a doctor's own price on his line", () => {
    const sheet = resolvePriceSheet(catalog());
    expect(sheet.groups.consultations).toEqual([
      [SUM(300_000)], // Бусаков, cabinet 1 override
      [SUM(200_000)], // Султанов, base price
      [SUM(200_000)],
      [SUM(200_000)],
    ]);
    expect(sheet.groups.diagnostics[0]).toEqual([SUM(150_000)]);
    expect(sheet.groups.diagnostics[8]).toEqual([SUM(80_000)]);
    expect(sheet.updatedAt).toEqual(UPDATED);
  });

  it("a price raised in the CRM is the price on the site", () => {
    const list = catalog();
    const eeg = list.find((s) => s.code === "EEG")!;
    eeg.priceBase = SUM(180_000);
    eeg.updatedAt = new Date("2026-09-29T10:00:00.000Z");
    const sheet = resolvePriceSheet(list);
    expect(sheet.groups.diagnostics[0]).toEqual([SUM(180_000)]);
    expect(sheet.updatedAt).toEqual(eeg.updatedAt);
  });

  it("leaves off a switched-off service, a doctor who no longer provides it", () => {
    const list = catalog();
    list.find((s) => s.code === "EKG")!.isActive = false;
    list.find((s) => s.code === "KONS_NEURO_ADULT")!.doctors = [
      { doctorSlug: "sultanov-aziz", priceOverride: null },
    ];
    const sheet = resolvePriceSheet(list);
    expect(sheet.groups.diagnostics[5]).toBeNull();
    expect(sheet.groups.consultations[0]).toBeNull();
    expect(sheet.groups.consultations[1]).toEqual([SUM(200_000)]);
  });

  it("a line of two services priced apart shows both", () => {
    const list = catalog();
    list.find((s) => s.code === "NSG")!.priceBase = SUM(90_000);
    expect(resolvePriceSheet(list).groups.diagnostics[8]).toEqual([SUM(80_000), SUM(90_000)]);
  });

  it("the sheet's lines match the message files in both languages, which carry no prices", () => {
    for (const msgs of [ru, uz]) {
      for (const group of PRICE_GROUPS) {
        const items = msgs.services.groups[group].items as Array<Record<string, unknown>>;
        expect(items).toHaveLength(PRICE_SHEET[group].length);
        for (const item of items) expect(item).not.toHaveProperty("price");
      }
      expect(msgs.services.subtitle).toContain("{date}");
    }
  });

  it("renders the catalog's numbers and the date of the latest change", async () => {
    const html = renderToStaticMarkup(
      React.createElement(Services, { sheet: await getSitePriceSheet() }),
    );
    expect(html).toContain("150 000");
    expect(html).toContain("300 000");
    expect(html).toContain("сум");
    expect(html).toContain("Прейскурант от 20.09.2026");
    expect(html).toContain("Бусаков Бахтияр");
    expect(html).toContain('id="services"');
  });

  it("shows no sheet at all rather than guessed prices when the catalog is unreachable", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.service.findMany).mockRejectedValueOnce(new Error("db down"));
    const sheet = await getSitePriceSheet();
    expect(renderToStaticMarkup(React.createElement(Services, { sheet }))).toBe("");
  });

  it("reads the catalog once a minute, and at once after an edit in the CRM", async () => {
    await getSitePriceSheet();
    await getSitePriceSheet();
    expect(state.serviceQueries).toBe(1);
    state.services = toDbRows(
      catalog().map((s) => (s.code === "EEG" ? { ...s, priceBase: SUM(180_000) } : s)),
    );
    invalidateSitePrices();
    const sheet = await getSitePriceSheet();
    expect(state.serviceQueries).toBe(2);
    expect(sheet.groups.diagnostics[0]).toEqual([SUM(180_000)]);
  });
});
