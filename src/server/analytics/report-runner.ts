/**
 * Phase 18 Wave 3 — execute a `ReportConfig` against the analytics DB.
 *
 * Wraps W1's `buildAnalyticsQuery` with:
 *   - `statement_timeout` (30s) so a runaway aggregate can't pin a
 *     connection. We set/reset inside a transaction so a missed cleanup
 *     can't leak the override to the next tenant request.
 *   - row truncation flag — caller can show "showing first N rows" hint
 *     when the LIMIT is hit.
 *   - column descriptors keyed by the dimension/measure aliases, so the
 *     CSV layer doesn't have to re-derive labels.
 *
 * Audit AN-09: everything the reader sees is in the interface language.
 * Headers come from `analyticsReports.dimensions.*` / `.measures.*` (they
 * used to be the catalog's English «Doctor», «Revenue (tiins)» while the
 * cells were already in сум); money headers carry «, сум»; doctor, branch
 * and specialty cells are names (query-builder.ts); segment and source
 * cells are their i18n names instead of enum codes. The interactive pages
 * pass the page locale, the scheduled worker uses Russian.
 */
import { createTranslator } from "next-intl";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

import {
  DIMENSIONS,
  type DimensionKey,
  type ReportLocale,
} from "./dimensions";
import {
  MEASURES,
  type MeasureKey,
  type MeasureDef,
} from "./measures";
import { buildAnalyticsQuery } from "./query-builder";
import {
  resolveDateRange,
  resolveLimit,
  type ReportConfig,
} from "./report-config";

export interface ReportColumn {
  key: string;
  label: string;
  /** "dimension" | "measure". Helps the UI render alignment / sort. */
  kind: "dimension" | "measure";
  unit?: MeasureDef["unit"] | "text" | "date";
}

export interface RunReportOptions {
  /** Language of headers and names; defaults to Russian. */
  locale?: ReportLocale;
}

export interface RunReportResult {
  rows: Array<Record<string, unknown>>;
  columns: ReportColumn[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
  runMs: number;
}

export interface ReportRunnerClient {
  $queryRawUnsafe: <T = unknown>(
    sql: string,
    ...values: unknown[]
  ) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
  $transaction: <T>(
    fn: (tx: ReportRunnerClient) => Promise<T>,
  ) => Promise<T>;
}

const TIMEOUT_MS = 30_000;

export class ReportTimeoutError extends Error {
  constructor() {
    super("ReportTimeout");
    this.name = "ReportTimeoutError";
  }
}

function messagesFor(locale: ReportLocale) {
  return locale === "uz" ? uz : ru;
}

/**
 * Build the column descriptor list in select order so the CSV / table
 * stay aligned with what the SQL projects. Labels are localized.
 */
export function buildReportColumns(
  dims: ReadonlyArray<DimensionKey>,
  measures: ReadonlyArray<MeasureKey>,
  locale: ReportLocale = "ru",
): ReportColumn[] {
  const t = createTranslator({
    locale,
    messages: messagesFor(locale),
    namespace: "analyticsReports",
  });
  const cols: ReportColumn[] = [];
  for (const k of dims) {
    const def = DIMENSIONS[k];
    cols.push({
      key: def.alias,
      label: t(`dimensions.${k}`),
      kind: "dimension",
      unit: def.unit,
    });
  }
  for (const k of measures) {
    const def = MEASURES[k];
    const name = t(`measures.${k}`);
    cols.push({
      key: def.alias,
      label: def.unit === "tiins" ? t("columnMoney", { label: name }) : name,
      kind: "measure",
      unit: def.unit,
    });
  }
  return cols;
}

/** Patient.segment enum → `patients.segment.*` key. */
const SEGMENT_KEYS = {
  NEW: "new",
  ACTIVE: "active",
  DORMANT: "dormant",
  VIP: "vip",
  CHURN: "churn",
} as const;

/** Appointment.channel enum → `appointments.channel.*` key. */
const CHANNEL_KEYS = {
  WALKIN: "walkin",
  PHONE: "phone",
  TELEGRAM: "telegram",
  WEBSITE: "website",
  KIOSK: "kiosk",
} as const;

/** Patient.source (LeadSource) values the channel list lacks → `patients.source.*`. */
const LEAD_SOURCE_KEYS = {
  INSTAGRAM: "instagram",
  CALL: "call",
  REFERRAL: "referral",
  ADS: "ads",
  OTHER: "other",
} as const;

/** `map[code]`, own keys only (a cell is data, never «toString»). */
function codeKey<M extends Record<string, string>>(
  map: M,
  code: string,
): M[keyof M] | null {
  return Object.hasOwn(map, code) ? (map[code as keyof M] as M[keyof M]) : null;
}

/**
 * Swap the segment and source enum codes for their names. The `source`
 * dimension is the visit's channel, else the patient's lead source, else
 * 'unknown' (dimensions.ts). An unexpected code passes through as is.
 */
export function localizeReportRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  dims: ReadonlyArray<DimensionKey>,
  locale: ReportLocale = "ru",
): Array<Record<string, unknown>> {
  const hasSegment = dims.includes("patient_segment");
  const hasSource = dims.includes("source");
  if (!hasSegment && !hasSource) return [...rows];
  const messages = messagesFor(locale);
  const tSegment = createTranslator({ locale, messages, namespace: "patients.segment" });
  const tChannel = createTranslator({ locale, messages, namespace: "appointments.channel" });
  const tLead = createTranslator({ locale, messages, namespace: "patients.source" });
  const tReports = createTranslator({ locale, messages, namespace: "analyticsReports" });

  const segmentName = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    const key = codeKey(SEGMENT_KEYS, v);
    return key ? tSegment(key) : v;
  };
  const sourceName = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    if (v === "unknown") return tReports("sourceUnknown");
    const channel = codeKey(CHANNEL_KEYS, v);
    if (channel) return tChannel(channel);
    const lead = codeKey(LEAD_SOURCE_KEYS, v);
    return lead ? tLead(lead) : v;
  };

  const segmentAlias = DIMENSIONS.patient_segment.alias;
  const sourceAlias = DIMENSIONS.source.alias;
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    if (hasSegment) out[segmentAlias] = segmentName(row[segmentAlias]);
    if (hasSource) out[sourceAlias] = sourceName(row[sourceAlias]);
    return out;
  });
}

function isStatementTimeout(err: unknown): boolean {
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message ?? "")
      : "";
  return /statement timeout|canceling statement|57014/i.test(msg);
}

/**
 * Run the report against `client`. The caller has already validated the
 * config via zod and resolved the tenant via `runWithTenant`.
 */
export async function runReport(
  client: ReportRunnerClient,
  clinicId: string,
  config: ReportConfig,
  now: Date = new Date(),
  opts: RunReportOptions = {},
): Promise<RunReportResult> {
  const locale: ReportLocale = opts.locale === "uz" ? "uz" : "ru";
  const { dateFrom, dateTo } = resolveDateRange(config, now);
  const limit = resolveLimit(config);
  const built = buildAnalyticsQuery({
    clinicId,
    dimensions: [...config.dimensions],
    measures: [...config.measures],
    locale,
    ordering: config.ordering,
    filters: {
      dateFrom,
      dateTo,
      branchIds: config.filters?.branchIds
        ? [...config.filters.branchIds]
        : undefined,
      doctorIds: config.filters?.doctorIds
        ? [...config.filters.doctorIds]
        : undefined,
      status: config.filters?.status ? [...config.filters.status] : undefined,
    },
    limit,
  });

  const startedAt = Date.now();
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await client.$transaction(async (tx) => {
      // statement_timeout is per-connection in PG; we set it inside the
      // tx so the override is scoped and rolled back.
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
      return tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        built.sql,
        ...built.values,
      );
    });
  } catch (err) {
    if (isStatementTimeout(err)) throw new ReportTimeoutError();
    throw err;
  }

  const runMs = Date.now() - startedAt;
  const columns = buildReportColumns(config.dimensions, config.measures, locale);
  return {
    rows: localizeReportRows(rows, config.dimensions, locale),
    columns,
    rowCount: rows.length,
    truncated: rows.length === limit,
    generatedAt: new Date().toISOString(),
    runMs,
  };
}
