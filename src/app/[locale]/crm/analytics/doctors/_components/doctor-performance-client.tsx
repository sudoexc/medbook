"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";

import { EmptyState } from "@/components/atoms/empty-state";
import { MoneyText } from "@/components/atoms/money-text";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  bandOf,
  computeQuartileBand,
  resolveDoctorPerfRange,
  type DoctorPerfRangeKind,
} from "@/lib/analytics/dashboard-math";
import type { DoctorPerformanceRow } from "@/server/analytics/doctor-performance-resolver";

interface DoctorMeta {
  id: string;
  nameRu: string;
  nameUz: string;
}

interface SparkPoint {
  month: string;
  revenueTiins: number;
  visitsCount: number;
}

export interface DoctorPerformanceClientProps {
  initialRows: DoctorPerformanceRow[];
  generatedAt: string;
  doctors: DoctorMeta[];
  sparklines: Record<string, SparkPoint[]>;
}

type SortKey =
  | "name"
  | "visitsCount"
  | "revenueTiins"
  | "avgTicketTiins"
  | "noShowPct"
  | "repeatPct"
  | "newSharePct"
  | "npsAvg"
  | "npsCount";

interface DerivedRow {
  doctorId: string;
  name: string;
  visitsCount: number;
  revenueTiins: number;
  avgTicketTiins: number;
  noShowPct: number;
  repeatPct: number;
  newSharePct: number;
  npsAvg: number | null;
  npsCount: number;
}

function deriveRow(
  raw: DoctorPerformanceRow,
  doctorName: string,
): DerivedRow {
  const totalForRates = raw.visitsCount + raw.noShowCount;
  const noShowPct = totalForRates > 0 ? raw.noShowCount / totalForRates : 0;
  const repeatPct =
    raw.visitsCount > 0 ? raw.repeatVisitCount / raw.visitsCount : 0;
  const newSharePct =
    raw.visitsCount > 0 ? raw.newPatientCount / raw.visitsCount : 0;
  const avgTicketTiins =
    raw.visitsCount > 0 ? Math.round(raw.revenueTiins / raw.visitsCount) : 0;
  return {
    doctorId: raw.doctorId,
    name: doctorName,
    visitsCount: raw.visitsCount,
    revenueTiins: raw.revenueTiins,
    avgTicketTiins,
    noShowPct,
    repeatPct,
    newSharePct,
    npsAvg: raw.npsAvg,
    npsCount: raw.npsCount,
  };
}

export function DoctorPerformanceClient({
  initialRows,
  generatedAt,
  doctors,
  sparklines,
}: DoctorPerformanceClientProps) {
  const t = useTranslations("analyticsDoctors");
  const tCommon = useTranslations("common");
  const locale = useLocale();

  const [rows, setRows] = React.useState(initialRows);
  const [generatedAtState, setGeneratedAtState] = React.useState(generatedAt);
  const [rangeKind, setRangeKind] = React.useState<DoctorPerfRangeKind>("30d");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>("revenueTiins");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [openDoctorId, setOpenDoctorId] = React.useState<string | null>(null);

  const doctorNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const d of doctors) {
      map.set(d.id, locale === "uz" && d.nameUz ? d.nameUz : d.nameRu);
    }
    return map;
  }, [doctors, locale]);

  // Re-fetch on toolbar change. Server already paid for the first paint;
  // subsequent ranges go through the W1 API route.
  const fetchRange = React.useCallback(
    async (kind: DoctorPerfRangeKind, from?: string, to?: string) => {
      const range = resolveDoctorPerfRange(
        kind,
        new Date(),
        kind === "custom" ? { from, to } : null,
      );
      const params = new URLSearchParams({
        monthFrom: range.from.toISOString(),
        monthTo: range.to.toISOString(),
        limit: "200",
      });
      setLoading(true);
      try {
        const res = await fetch(`/api/crm/analytics/doctors?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`doctor-perf ${res.status}`);
        const json = (await res.json()) as {
          data: { rows: DoctorPerformanceRow[]; generatedAt: string };
        };
        setRows(json.data.rows);
        setGeneratedAtState(json.data.generatedAt);
      } catch {
        // Stay on the previous payload — better than blanking the table.
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    if (rangeKind === "custom" && (!customFrom || !customTo)) return;
    if (rangeKind === "30d") return; // already loaded
    void fetchRange(rangeKind, customFrom, customTo);
  }, [rangeKind, customFrom, customTo, fetchRange]);

  const derived = React.useMemo(
    () =>
      rows.map((r) =>
        deriveRow(r, doctorNameById.get(r.doctorId) ?? r.doctorId.slice(0, 6)),
      ),
    [rows, doctorNameById],
  );

  const revenueBand = React.useMemo(
    () => computeQuartileBand(derived.map((r) => r.revenueTiins)),
    [derived],
  );

  const sorted = React.useMemo(() => {
    const copy = [...derived];
    copy.sort((a, b) => {
      const va = pickSortValue(a, sortKey);
      const vb = pickSortValue(b, sortKey);
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      const an = typeof va === "number" ? va : -Infinity;
      const bn = typeof vb === "number" ? vb : -Infinity;
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [derived, sortKey, sortDir]);

  const flipSort = (next: SortKey) => {
    if (next === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(next);
      setSortDir(next === "name" ? "asc" : "desc");
    }
  };

  const openDoctor = openDoctorId
    ? sorted.find((r) => r.doctorId === openDoctorId) ?? null
    : null;

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <RangeToolbar
            rangeKind={rangeKind}
            onRangeChange={setRangeKind}
            customFrom={customFrom}
            customTo={customTo}
            onCustomFromChange={setCustomFrom}
            onCustomToChange={setCustomTo}
            loading={loading}
          />
        }
      />

      {sorted.length === 0 ? (
        <EmptyState title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={() => flipSort("name")}
                  label={t("col.name")}
                  align="left"
                />
                <SortHeader
                  active={sortKey === "visitsCount"}
                  dir={sortDir}
                  onClick={() => flipSort("visitsCount")}
                  label={t("col.visits")}
                />
                <SortHeader
                  active={sortKey === "revenueTiins"}
                  dir={sortDir}
                  onClick={() => flipSort("revenueTiins")}
                  label={t("col.revenue")}
                />
                <SortHeader
                  active={sortKey === "avgTicketTiins"}
                  dir={sortDir}
                  onClick={() => flipSort("avgTicketTiins")}
                  label={t("col.avgTicket")}
                />
                <SortHeader
                  active={sortKey === "noShowPct"}
                  dir={sortDir}
                  onClick={() => flipSort("noShowPct")}
                  label={t("col.noShow")}
                />
                <SortHeader
                  active={sortKey === "repeatPct"}
                  dir={sortDir}
                  onClick={() => flipSort("repeatPct")}
                  label={t("col.repeat")}
                />
                <SortHeader
                  active={sortKey === "newSharePct"}
                  dir={sortDir}
                  onClick={() => flipSort("newSharePct")}
                  label={t("col.newShare")}
                />
                <SortHeader
                  active={sortKey === "npsAvg"}
                  dir={sortDir}
                  onClick={() => flipSort("npsAvg")}
                  label={t("col.nps")}
                />
                <SortHeader
                  active={sortKey === "npsCount"}
                  dir={sortDir}
                  onClick={() => flipSort("npsCount")}
                  label={t("col.npsResp")}
                />
                <TableHead className="text-right">{t("col.trend")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => {
                const tier = bandOf(r.revenueTiins, revenueBand);
                const tone =
                  tier === "top"
                    ? "bg-success/10"
                    : tier === "bottom"
                      ? "bg-destructive/10"
                      : "";
                const points = sparklines[r.doctorId] ?? [];
                return (
                  <TableRow
                    key={r.doctorId}
                    className={`${tone} cursor-pointer hover:bg-muted/40`}
                    onClick={() => setOpenDoctorId(r.doctorId)}
                  >
                    <TableCell className="font-medium text-foreground">
                      {r.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.visitsCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <MoneyText amount={r.revenueTiins} currency="UZS" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <MoneyText amount={r.avgTicketTiins} currency="UZS" />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(r.noShowPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(r.repeatPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(r.newSharePct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.npsAvg == null ? "—" : r.npsAvg.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.npsCount}
                    </TableCell>
                    <TableCell className="text-right">
                      <Sparkline
                        values={points.map((p) => p.revenueTiins)}
                        ariaLabel={t("sparkAria", { name: r.name })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t("metaHint", {
          generatedAt: new Date(generatedAtState).toLocaleString(),
        })}
      </p>

      {openDoctor ? (
        <DoctorDrillDownDrawer
          row={openDoctor}
          points={sparklines[openDoctor.doctorId] ?? []}
          onClose={() => setOpenDoctorId(null)}
          closeLabel={tCommon("close")}
        />
      ) : null}
    </PageContainer>
  );
}

function pickSortValue(r: DerivedRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return r.name;
    case "visitsCount":
      return r.visitsCount;
    case "revenueTiins":
      return r.revenueTiins;
    case "avgTicketTiins":
      return r.avgTicketTiins;
    case "noShowPct":
      return r.noShowPct;
    case "repeatPct":
      return r.repeatPct;
    case "newSharePct":
      return r.newSharePct;
    case "npsAvg":
      return r.npsAvg ?? -Infinity;
    case "npsCount":
      return r.npsCount;
  }
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function SortHeader({
  active,
  dir,
  onClick,
  label,
  align = "right",
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  label: string;
  align?: "left" | "right";
}) {
  const arrow = active ? (dir === "asc" ? "↑" : "↓") : "";
  return (
    <TableHead className={align === "right" ? "text-right" : "text-left"}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {label}
        {arrow ? <span aria-hidden>{arrow}</span> : null}
      </button>
    </TableHead>
  );
}

function Sparkline({
  values,
  ariaLabel,
}: {
  values: number[];
  ariaLabel: string;
}) {
  if (values.length < 2) {
    return (
      <span aria-label={ariaLabel} className="text-xs text-muted-foreground">
        —
      </span>
    );
  }
  const w = 80;
  const h = 22;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={ariaLabel}
      className="inline-block align-middle"
    >
      <polyline
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        points={points}
      />
    </svg>
  );
}

function RangeToolbar({
  rangeKind,
  onRangeChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  loading,
}: {
  rangeKind: DoctorPerfRangeKind;
  onRangeChange: (k: DoctorPerfRangeKind) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  loading: boolean;
}) {
  const t = useTranslations("analyticsDoctors.range");
  const opts: DoctorPerfRangeKind[] = ["30d", "90d", "ytd", "custom"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-background p-0.5">
        {opts.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={rangeKind === p ? "default" : "ghost"}
            onClick={() => onRangeChange(p)}
            className="h-7 px-3 text-xs"
            disabled={loading}
          >
            {t(p)}
          </Button>
        ))}
      </div>
      {rangeKind === "custom" ? (
        <div className="flex items-center gap-1.5 text-xs">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => onCustomFromChange(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => onCustomToChange(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-foreground"
          />
        </div>
      ) : null}
    </div>
  );
}

function DoctorDrillDownDrawer({
  row,
  points,
  onClose,
  closeLabel,
}: {
  row: DerivedRow;
  points: SparkPoint[];
  onClose: () => void;
  closeLabel: string;
}) {
  const t = useTranslations("analyticsDoctors.drawer");
  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              {row.name}
            </h3>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {closeLabel}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Stat label={t("visits")} value={String(row.visitsCount)} />
          <Stat
            label={t("revenue")}
            value={
              <MoneyText amount={row.revenueTiins} currency="UZS" />
            }
          />
          <Stat label={t("avgTicket")} value={<MoneyText amount={row.avgTicketTiins} currency="UZS" />} />
          <Stat label={t("noShow")} value={pct(row.noShowPct)} />
          <Stat label={t("repeat")} value={pct(row.repeatPct)} />
          <Stat label={t("newShare")} value={pct(row.newSharePct)} />
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("trendTitle")}
          </div>
          <MonthlyTrendChart points={points} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function MonthlyTrendChart({ points }: { points: SparkPoint[] }) {
  const t = useTranslations("analyticsDoctors.drawer");
  if (points.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("trendEmpty")}</p>
    );
  }
  const w = 320;
  const h = 90;
  const padX = 28;
  const padY = 8;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const maxRev = Math.max(...points.map((p) => p.revenueTiins), 1);
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const linePath = points
    .map((p, i) => {
      const x = padX + i * stepX;
      const y = padY + (1 - p.revenueTiins / maxRev) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-foreground">
      <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
      {points.map((p, i) => (
        <g key={p.month}>
          <text
            x={padX + i * stepX}
            y={h - 1}
            fontSize="9"
            textAnchor="middle"
            fill="var(--muted-foreground)"
          >
            {p.month.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}
