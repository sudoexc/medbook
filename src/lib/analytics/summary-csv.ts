/**
 * The «Скачать отчёт» CSV of the analytics overview (audit AN-28).
 * Client-safe and pure: the page builds the file in the browser from the
 * `/api/crm/analytics` payload it already holds.
 *
 * Money arrives in тийин (Int minor units) and is written in сум, the unit
 * every screen shows: the export used to put raw тийин in the cells, so a
 * week's 12 500 000 сум read as 1 250 000 000 once payments were tracked.
 * The file starts with a UTF-8 BOM because Excel on Windows otherwise opens
 * a .csv in a legacy codepage and garbles Cyrillic doctor and service names
 * (the report builder's CSV does the same, src/server/analytics/csv.ts).
 */
import { tiyinToSum } from "@/lib/money-input";

const BOM = "﻿";

export interface AnalyticsSummaryCsvInput {
  period: string;
  /** Already formatted for the viewer, e.g. «22 сент. 2026 г.». */
  rangeStart: string;
  rangeEnd: string;
  generatedAt: Date;
  /** False: the clinic does not record payments, money cells stay empty. */
  paymentsTracked: boolean;
  /** Daily revenue, тийин. */
  revenueDaily: ReadonlyArray<{ amount: number | null }>;
  appointmentsByStatus: ReadonlyArray<{ status: string; count: number | null }>;
  noShowDaily: ReadonlyArray<{ total: number | null; noShow: number | null }>;
  /** Revenue per doctor, тийин. */
  topDoctors: ReadonlyArray<{ name: string; revenue: number }>;
  topServices: ReadonlyArray<{ name: string; count: number }>;
  sources: ReadonlyArray<{ source: string; count: number }>;
}

function csvEscape(v: unknown): string {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The CSV document, BOM included, CRLF line ends (RFC 4180). */
export function buildAnalyticsSummaryCsv(input: AnalyticsSummaryCsvInput): string {
  const totalRevenue = input.revenueDaily.reduce(
    (sum, d) => sum + (d.amount ?? 0),
    0,
  );
  const totalAppointments = input.appointmentsByStatus.reduce(
    (sum, s) => sum + (s.count ?? 0),
    0,
  );
  const noShowAgg = input.noShowDaily.reduce<{ total: number; noShow: number }>(
    (acc, d) => ({
      total: acc.total + (d.total ?? 0),
      noShow: acc.noShow + (d.noShow ?? 0),
    }),
    { total: 0, noShow: 0 },
  );
  const noShowPct =
    noShowAgg.total > 0
      ? Math.round((noShowAgg.noShow / noShowAgg.total) * 1000) / 10
      : 0;

  // Money is exported only when the clinic records payments in the CRM;
  // otherwise the cells stay empty rather than read as a real «0».
  const moneyTracked = input.paymentsTracked;
  const rows: string[][] = [
    ["section", "key", "value"],
    ["meta", "period", input.period],
    ["meta", "range_start", input.rangeStart],
    ["meta", "range_end", input.rangeEnd],
    ["meta", "generated_at", input.generatedAt.toISOString()],
  ];
  if (moneyTracked) rows.push(["meta", "currency", "UZS"]);
  rows.push(
    ["kpi", "revenue_total", moneyTracked ? String(tiyinToSum(totalRevenue)) : ""],
    ["kpi", "appointments_total", String(totalAppointments)],
    ["kpi", "no_show_pct", String(noShowPct)],
  );
  for (const s of input.appointmentsByStatus) {
    rows.push(["appointmentsByStatus", s.status, String(s.count ?? 0)]);
  }
  if (moneyTracked) {
    for (const d of input.topDoctors) {
      rows.push(["topDoctors", d.name, String(tiyinToSum(d.revenue))]);
    }
  }
  for (const s of input.topServices) {
    rows.push(["topServices", s.name, String(s.count)]);
  }
  for (const s of input.sources) {
    rows.push(["sources", s.source, String(s.count)]);
  }
  return BOM + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}
