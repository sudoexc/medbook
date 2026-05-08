"use client";

/**
 * Phase 18 Wave 3 — interactive report builder.
 *
 * Layout: name+description → dimensions chips → measures chips → filters →
 * Run → result table → Save row. Save is disabled until a run succeeds so
 * we don't persist a config that crashes the runner.
 *
 * Drag-reordering of dimensions is done with arrow buttons rather than a
 * full DnD lib. The strip is small (max 3 entries) — UX is fine, bundle
 * stays lean.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";

import {
  DIMENSION_KEYS,
  type DimensionKey,
} from "@/server/analytics/dimensions";
import {
  MEASURE_KEYS,
  type MeasureKey,
} from "@/server/analytics/measures";
import {
  APPOINTMENT_STATUS_VALUES,
  type ReportAppointmentStatus,
  type ReportConfig,
} from "@/server/analytics/report-config";

interface BranchOption {
  id: string;
  label: string;
}
interface DoctorOption {
  id: string;
  label: string;
}

export interface ReportBuilderClientProps {
  locale: "ru" | "uz";
  branches: BranchOption[];
  doctors: DoctorOption[];
  /** When set, the page is in "edit mode" — Save button issues a PATCH. */
  initialReport?: {
    id: string;
    name: string;
    description: string | null;
    config: ReportConfig;
  };
}

interface ReportColumnDescriptor {
  key: string;
  label: string;
  kind: "dimension" | "measure";
  unit?: "count" | "tiins" | "ratio" | "text";
}

interface ReportRunResponse {
  rows: Array<Record<string, unknown>>;
  columns: ReportColumnDescriptor[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
}

const STATUSES = APPOINTMENT_STATUS_VALUES;

function moveItem<T>(arr: ReadonlyArray<T>, idx: number, dir: -1 | 1): T[] {
  const next = arr.slice();
  const target = idx + dir;
  if (target < 0 || target >= next.length) return next;
  const tmp = next[idx]!;
  next[idx] = next[target]!;
  next[target] = tmp;
  return next;
}

function formatCellForTable(
  v: unknown,
  unit: ReportColumnDescriptor["unit"],
): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    if (unit === "tiins") {
      const n = Number(v);
      if (Number.isFinite(n)) return formatTiins(n);
      return v;
    }
    return v;
  }
  if (typeof v === "number") {
    if (unit === "tiins") return formatTiins(v);
    if (unit === "ratio") return `${(v * 100).toFixed(1)}%`;
    return v.toLocaleString();
  }
  if (typeof v === "bigint") {
    if (unit === "tiins") return formatTiins(Number(v));
    return v.toString();
  }
  return String(v);
}

function formatTiins(tiins: number): string {
  const soum = tiins / 100;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(soum));
}

export function ReportBuilderClient({
  locale,
  branches,
  doctors,
  initialReport,
}: ReportBuilderClientProps): React.JSX.Element {
  const t = useTranslations("analyticsReports.builder");
  const tDim = useTranslations("analyticsReports.dimensions");
  const tMeasure = useTranslations("analyticsReports.measures");
  const tStatus = useTranslations("analyticsReports.status");
  const router = useRouter();

  const [name, setName] = React.useState(initialReport?.name ?? "");
  const [description, setDescription] = React.useState(
    initialReport?.description ?? "",
  );
  const [dims, setDims] = React.useState<DimensionKey[]>(
    initialReport ? [...initialReport.config.dimensions] : [],
  );
  const [measures, setMeasures] = React.useState<MeasureKey[]>(
    initialReport ? [...initialReport.config.measures] : [],
  );
  const [dateFrom, setDateFrom] = React.useState<string>(
    initialReport?.config.filters?.dateFrom ?? "",
  );
  const [dateTo, setDateTo] = React.useState<string>(
    initialReport?.config.filters?.dateTo ?? "",
  );
  const [branchIds, setBranchIds] = React.useState<string[]>(
    initialReport?.config.filters?.branchIds
      ? [...initialReport.config.filters.branchIds]
      : [],
  );
  const [doctorIds, setDoctorIds] = React.useState<string[]>(
    initialReport?.config.filters?.doctorIds
      ? [...initialReport.config.filters.doctorIds]
      : [],
  );
  const [statuses, setStatuses] = React.useState<ReportAppointmentStatus[]>(
    initialReport?.config.filters?.status
      ? [...initialReport.config.filters.status]
      : [],
  );

  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<ReportRunResponse | null>(null);
  const [hasRunSuccessfully, setHasRunSuccessfully] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const addDim = (k: DimensionKey) => {
    if (dims.includes(k) || dims.length >= 3) return;
    setDims([...dims, k]);
  };
  const removeDim = (k: DimensionKey) => setDims(dims.filter((d) => d !== k));
  const moveDim = (idx: number, dir: -1 | 1) => setDims(moveItem(dims, idx, dir));

  const addMeasure = (k: MeasureKey) => {
    if (measures.includes(k) || measures.length >= 5) return;
    setMeasures([...measures, k]);
  };
  const removeMeasure = (k: MeasureKey) =>
    setMeasures(measures.filter((m) => m !== k));

  const toggleBranch = (id: string) =>
    setBranchIds(
      branchIds.includes(id)
        ? branchIds.filter((x) => x !== id)
        : [...branchIds, id],
    );
  const toggleDoctor = (id: string) =>
    setDoctorIds(
      doctorIds.includes(id)
        ? doctorIds.filter((x) => x !== id)
        : [...doctorIds, id],
    );
  const toggleStatus = (s: ReportAppointmentStatus) =>
    setStatuses(
      statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s],
    );

  const buildConfig = React.useCallback((): ReportConfig | null => {
    if (dims.length === 0 || measures.length === 0) return null;
    return {
      version: 1,
      dimensions: dims,
      measures,
      filters: {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        branchIds: branchIds.length > 0 ? branchIds : undefined,
        doctorIds: doctorIds.length > 0 ? doctorIds : undefined,
        status: statuses.length > 0 ? statuses : undefined,
      },
    };
  }, [dims, measures, dateFrom, dateTo, branchIds, doctorIds, statuses]);

  const runDisabled = dims.length === 0 || measures.length === 0 || running;
  const saveDisabled =
    !hasRunSuccessfully ||
    name.trim().length === 0 ||
    dims.length === 0 ||
    measures.length === 0 ||
    saving;

  const handleRun = async () => {
    const config = buildConfig();
    if (!config) return;
    setRunning(true);
    try {
      const r = await fetch("/api/crm/analytics/reports/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config, name: name || undefined }),
      });
      if (!r.ok) {
        const text = await r.text();
        let msg = t("toastRunFailed");
        try {
          const parsed = JSON.parse(text);
          if (parsed.error === "ReportTimeout") msg = t("toastRunTimeout");
        } catch {
          // keep default
        }
        toast.error(msg);
        setHasRunSuccessfully(false);
        return;
      }
      const data: ReportRunResponse = await r.json();
      setResult(data);
      setHasRunSuccessfully(true);
    } catch {
      toast.error(t("toastRunFailed"));
      setHasRunSuccessfully(false);
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    const config = buildConfig();
    if (!config) return;
    setSaving(true);
    try {
      const isEdit = !!initialReport;
      const url = isEdit
        ? `/api/crm/analytics/reports/${initialReport!.id}`
        : "/api/crm/analytics/reports";
      const method = isEdit ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          config,
        }),
      });
      if (r.status === 409) {
        toast.error(t("toastNameTaken"));
        return;
      }
      if (r.status === 422) {
        toast.error(t("toastInvalidConfig"));
        return;
      }
      if (!r.ok) {
        toast.error(t("toastSaveFailed"));
        return;
      }
      const data = await r.json();
      const id = isEdit ? initialReport!.id : data.id;
      toast.success(t("toastSaved"));
      router.push(`/${locale}/crm/analytics/reports/${id}`);
    } catch {
      toast.error(t("toastSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = async () => {
    const config = buildConfig();
    if (!config) return;
    try {
      const r = await fetch("/api/crm/analytics/reports/run?format=csv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config, name: name || undefined }),
      });
      if (!r.ok) {
        toast.error(t("toastExportFailed"));
        return;
      }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const cd = r.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      a.download = m?.[1] ?? "report.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error(t("toastExportFailed"));
    }
  };

  return (
    <PageContainer>
      <SectionHeader
        title={initialReport ? t("titleEdit") : t("titleNew")}
        subtitle={t("subtitle")}
      />

      <section className="grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="rb-name">{t("nameLabel")}</Label>
          <Input
            id="rb-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            maxLength={120}
          />
        </div>
        <div>
          <Label htmlFor="rb-desc">{t("descriptionLabel")}</Label>
          <Textarea
            id="rb-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            rows={2}
            maxLength={2000}
          />
        </div>
      </section>

      <section className="mt-6 rounded-md border p-4">
        <h3 className="text-sm font-semibold">
          {t("dimensionsTitle")}{" "}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t("dimensionsHint", { current: dims.length, max: 3 })}
          </span>
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {DIMENSION_KEYS.map((k) => {
            const active = dims.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => (active ? removeDim(k) : addDim(k))}
                disabled={!active && dims.length >= 3}
                className={
                  active
                    ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground"
                    : "rounded-full border px-3 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {tDim(k)}
              </button>
            );
          })}
        </div>
        {dims.length > 0 ? (
          <ol className="mt-4 flex flex-col gap-2">
            {dims.map((k, i) => (
              <li
                key={k}
                className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"
              >
                <span>
                  <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                  {tDim(k)}
                </span>
                <span className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === 0}
                    onClick={() => moveDim(i, -1)}
                    aria-label={t("dimMoveUp")}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={i === dims.length - 1}
                    onClick={() => moveDim(i, 1)}
                    aria-label={t("dimMoveDown")}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeDim(k)}
                    aria-label={t("dimRemove")}
                  >
                    ×
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <section className="mt-4 rounded-md border p-4">
        <h3 className="text-sm font-semibold">
          {t("measuresTitle")}{" "}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {t("measuresHint", { current: measures.length, max: 5 })}
          </span>
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {MEASURE_KEYS.map((k) => {
            const active = measures.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => (active ? removeMeasure(k) : addMeasure(k))}
                disabled={!active && measures.length >= 5}
                className={
                  active
                    ? "rounded-full border border-primary bg-primary px-3 py-1 text-xs text-primary-foreground"
                    : "rounded-full border px-3 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {tMeasure(k)}
              </button>
            );
          })}
        </div>
        {measures.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {measures.map((k, i) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1"
              >
                <span>
                  {i + 1}. {tMeasure(k)}
                </span>
                <button
                  type="button"
                  onClick={() => removeMeasure(k)}
                  aria-label={t("measureRemove")}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-md border p-4">
        <h3 className="text-sm font-semibold">{t("filtersTitle")}</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="rb-from">{t("filterDateFrom")}</Label>
            <Input
              id="rb-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="rb-to">{t("filterDateTo")}</Label>
            <Input
              id="rb-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-3">
          <Label>{t("filterBranches")}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {branches.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("noBranches")}
              </span>
            ) : null}
            {branches.map((b) => {
              const active = branchIds.includes(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => toggleBranch(b.id)}
                  className={
                    active
                      ? "rounded border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground"
                      : "rounded border px-2 py-1 text-xs hover:bg-muted"
                  }
                >
                  {b.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3">
          <Label>{t("filterDoctors")}</Label>
          <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {doctors.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                {t("noDoctors")}
              </span>
            ) : null}
            {doctors.map((d) => {
              const active = doctorIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDoctor(d.id)}
                  className={
                    active
                      ? "rounded border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground"
                      : "rounded border px-2 py-1 text-xs hover:bg-muted"
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-3">
          <Label>{t("filterStatuses")}</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUSES.map((s) => {
              const active = statuses.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={
                    active
                      ? "rounded border border-primary bg-primary px-2 py-1 text-xs text-primary-foreground"
                      : "rounded border px-2 py-1 text-xs hover:bg-muted"
                  }
                >
                  {tStatus(s)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mt-4 flex items-center gap-3">
        <Button onClick={handleRun} disabled={runDisabled}>
          {running ? t("runRunning") : t("runButton")}
        </Button>
        {result ? (
          <Button variant="outline" onClick={handleExportCsv}>
            {t("exportCsv")}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {t("runHint")}
        </span>
      </section>

      {result ? (
        <section className="mt-6 rounded-md border">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
            <span>
              {t("resultRowCount", { count: result.rowCount })}
              {result.truncated ? ` · ${t("resultTruncated")}` : ""}
            </span>
            <span>
              {t("resultGeneratedAt", {
                ts: new Date(result.generatedAt).toLocaleString(),
              })}
            </span>
          </div>
          {result.rowCount === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t("resultEmpty")}
            </div>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs">
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c.key}
                        className="border-b px-3 py-2 text-left font-medium"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      {result.columns.map((c) => (
                        <td
                          key={c.key}
                          className={
                            c.kind === "measure"
                              ? "px-3 py-1.5 text-right tabular-nums"
                              : "px-3 py-1.5"
                          }
                        >
                          {formatCellForTable(row[c.key], c.unit)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-6 flex items-center gap-3">
        <Button onClick={handleSave} disabled={saveDisabled}>
          {saving
            ? t("saveSaving")
            : initialReport
              ? t("saveButtonEdit")
              : t("saveButton")}
        </Button>
        {!hasRunSuccessfully ? (
          <span className="text-xs text-muted-foreground">
            {t("saveHint")}
          </span>
        ) : null}
      </section>
    </PageContainer>
  );
}
