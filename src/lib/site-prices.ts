/**
 * The public price sheet (/#services), priced from the CRM catalog (audit
 * LD-07).
 *
 * The landing used to read the prices as strings from the message files
 * («300 000»), a copy of the 18.05.2026 sheet that nothing tied to
 * `Service.priceBase`, the price reception bills. An admin raising the EEG
 * from 150 000 to 180 000 in the CRM left the site at 150 000 for months, and
 * the patient argued at the desk.
 *
 * The sheet's wording stays in the message files (names, notes, the doctor
 * names on the two neurologist lines, in both languages, as approved); the
 * numbers come from the catalog:
 *   - `PRICE_SHEET` says which service each printed line is, index by index
 *     with `services.groups.<group>.items` (a unit test holds the two
 *     aligned in both locales);
 *   - a line tied to a doctor takes his own price (`ServiceOnDoctor.
 *     priceOverride`, the cabinet 1 consultation is 300 000 against the base
 *     200 000), else the base price;
 *   - a line whose service was switched off, or whose doctor no longer
 *     provides it, is left off the sheet rather than printed with a stale
 *     number; a line of two services priced differently shows both
 *     («80 000 / 90 000»);
 *   - «Прейскурант от» is the latest change of a listed service.
 *
 * Reads run without a session, like `getDoctors`: the concrete clinic by
 * slug, SYSTEM context, explicit clinicId. The result is kept for a minute
 * per process and dropped at once when the catalog is edited in the CRM
 * (`invalidateSitePrices`), so a new price shows on the next page load
 * without every landing hit querying the catalog.
 */
import { prisma } from "./prisma";
import { runWithTenant } from "./tenant-context";
import { DEFAULT_CLINIC_SLUG } from "./constants";

export const PRICE_GROUPS = ["consultations", "diagnostics"] as const;
export type PriceGroup = (typeof PRICE_GROUPS)[number];

export type PriceLineSpec = {
  /** Service codes the line stands for (`Service.code`). */
  codes: readonly string[];
  /** The line names a doctor: his price, and only while he provides it. */
  doctorSlug?: string;
};

/** Index by index with `services.groups.<group>.items` in ru.json / uz.json. */
export const PRICE_SHEET: Record<PriceGroup, readonly PriceLineSpec[]> = {
  consultations: [
    // «Консультация невролога · Бусаков Бахтияр»
    { codes: ["KONS_NEURO_ADULT"], doctorSlug: "busakov-bahtiyar" },
    // «Консультация невролога · Султанов Азиз»
    { codes: ["KONS_NEURO_ADULT"], doctorSlug: "sultanov-aziz" },
    // «Детский невролог и педиатр»
    { codes: ["KONS_PED_NEURO"] },
    // «Консультация кардиолога»
    { codes: ["KONS_KARDIO"] },
  ],
  diagnostics: [
    { codes: ["EEG"] },
    // «ЭЭГ во сне и детям до 6 лет»
    { codes: ["EEG_30"] },
    // «ЭЭГ во сне, 1 час»
    { codes: ["EEG_60"] },
    { codes: ["REO_EG"] },
    { codes: ["EHO_EG"] },
    { codes: ["EKG"] },
    { codes: ["EHO_KG"] },
    { codes: ["DOPPLER_BCA"] },
    // «УЗИ одного органа / нейросонография»
    { codes: ["UZI_ORGAN", "NSG"] },
  ],
};

export type CatalogService = {
  code: string;
  priceBase: number;
  isActive: boolean;
  updatedAt: Date;
  doctors: Array<{ priceOverride: number | null; doctorSlug: string }>;
};

export type SitePriceSheet = {
  /**
   * Per group, per printed line: the line's prices in tiyin (one, or more
   * when its services differ), or null when the line is not offered now.
   */
  groups: Record<PriceGroup, Array<number[] | null>>;
  /** Latest change of a listed service, or null when nothing is priced. */
  updatedAt: Date | null;
};

/** Price one line from the catalog, or null when it cannot be offered. */
function priceLine(
  spec: PriceLineSpec,
  byCode: Map<string, CatalogService>,
  used: Set<CatalogService>,
): number[] | null {
  const prices: number[] = [];
  for (const code of spec.codes) {
    const svc = byCode.get(code);
    if (!svc || !svc.isActive) continue;
    let price: number;
    if (spec.doctorSlug) {
      const link = svc.doctors.find((d) => d.doctorSlug === spec.doctorSlug);
      if (!link) continue;
      price = link.priceOverride ?? svc.priceBase;
    } else {
      price = svc.priceBase;
    }
    if (!Number.isFinite(price) || price <= 0) continue;
    used.add(svc);
    if (!prices.includes(price)) prices.push(price);
  }
  if (prices.length === 0) return null;
  return prices.sort((a, b) => a - b);
}

/** The sheet priced from catalog rows. Pure; exported for tests. */
export function resolvePriceSheet(services: CatalogService[]): SitePriceSheet {
  const byCode = new Map(services.map((s) => [s.code, s]));
  const used = new Set<CatalogService>();
  const groups = {} as SitePriceSheet["groups"];
  for (const group of PRICE_GROUPS) {
    groups[group] = PRICE_SHEET[group].map((spec) =>
      priceLine(spec, byCode, used),
    );
  }
  let updatedAt: Date | null = null;
  for (const svc of used) {
    if (!updatedAt || svc.updatedAt > updatedAt) updatedAt = svc.updatedAt;
  }
  return { groups, updatedAt };
}

/** A sheet with nothing priced: the section is left off the page. */
export function emptyPriceSheet(): SitePriceSheet {
  const groups = {} as SitePriceSheet["groups"];
  for (const group of PRICE_GROUPS) {
    groups[group] = PRICE_SHEET[group].map(() => null);
  }
  return { groups, updatedAt: null };
}

/**
 * «300 000»: whole сум from tiyin, grouped by thousands with a space, the
 * same digits `formatMoney(…, "UZS", …)` prints before its unit (the sheet
 * sets the unit in a lighter style of its own).
 */
export function formatSumAmount(tiyin: number): string {
  const whole = Math.trunc(tiyin / 100);
  const sign = whole < 0 ? "-" : "";
  return (
    sign + Math.abs(whole).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  );
}

const CACHE_TTL_MS = 60_000;
let cache: { at: number; sheet: SitePriceSheet } | null = null;

/** Drop the cached sheet: the catalog was edited in the CRM. */
export function invalidateSitePrices(): void {
  cache = null;
}

async function loadCatalog(): Promise<CatalogService[] | null> {
  const clinic = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findFirst({
      where: { slug: DEFAULT_CLINIC_SLUG, active: true },
      select: { id: true },
    }),
  );
  if (!clinic) return null;
  const codes = Array.from(
    new Set(PRICE_GROUPS.flatMap((g) => PRICE_SHEET[g].flatMap((l) => l.codes))),
  );
  const rows = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.service.findMany({
      where: { clinicId: clinic.id, code: { in: codes } },
      select: {
        code: true,
        priceBase: true,
        isActive: true,
        updatedAt: true,
        doctors: {
          select: { priceOverride: true, doctor: { select: { slug: true } } },
        },
      },
    }),
  );
  return rows.map((r) => ({
    code: r.code,
    priceBase: r.priceBase,
    isActive: r.isActive,
    updatedAt: r.updatedAt,
    doctors: r.doctors.map((d) => ({
      priceOverride: d.priceOverride,
      doctorSlug: d.doctor.slug,
    })),
  }));
}

/**
 * The sheet for the landing. Never throws: on a database hiccup the section
 * is left off the page (like the doctors section) instead of a 500 on the
 * clinic's front door, and never shows a price it could not read.
 */
export async function getSitePriceSheet(): Promise<SitePriceSheet> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.sheet;
  try {
    const catalog = await loadCatalog();
    const sheet = catalog ? resolvePriceSheet(catalog) : emptyPriceSheet();
    cache = { at: now, sheet };
    return sheet;
  } catch (e) {
    console.warn(`[site] price sheet failed: ${(e as Error).message}`);
    return emptyPriceSheet();
  }
}
