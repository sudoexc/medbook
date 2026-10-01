"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { SaveIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { tiyinToSum } from "@/lib/money-input";
import {
  DOCTOR_SERVICE_DURATION_MAX,
  DOCTOR_SERVICE_DURATION_MIN,
} from "@/lib/doctor-service-terms";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, type Locale } from "@/lib/format";

import { doctorKey } from "../_hooks/use-doctor";
import {
  adoptBaseline,
  assignmentsEqual,
  buildAssignments,
  rowProblem,
  type AssignmentPayload,
  type AssignmentState,
} from "./doctor-services-state";

type ServiceRow = {
  id: string;
  code: string;
  nameRu: string;
  nameUz: string;
  durationMin: number;
  priceBase: number;
  isActive: boolean;
};

type DoctorServiceRow = {
  serviceId: string;
  service: ServiceRow;
  priceOverride: number | null;
  durationMinOverride: number | null;
};

// `n` is priceBase in tiins (×100); formatMoney handles minor-unit conversion
// and unit label. The legacy inline formatter showed tiins as if they were
// whole UZS (a 100x inflation bug); centralizing fixes it.
const fmtUzs = (n: number, locale: Locale): string =>
  formatMoney(n, "UZS", locale);

const servicesKey = ["services-all"] as const;
const doctorServicesKey = (id: string) =>
  ["doctor-services", id] as const;

export interface DoctorServicesEditorProps {
  doctorId: string;
  /** If false, the Save button is hidden and inputs render read-only. */
  canEdit: boolean;
  className?: string;
}

export function DoctorServicesEditor({
  doctorId,
  canEdit,
  className,
}: DoctorServicesEditorProps) {
  const t = useTranslations("crmDoctors.services");
  const tToast = useTranslations("crmToasts.doctor");
  const locale = useLocale();
  const qc = useQueryClient();

  const servicesQuery = useQuery<ServiceRow[], Error>({
    queryKey: servicesKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/services?isActive=true&limit=200`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: ServiceRow[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });

  const doctorServicesQuery = useQuery<DoctorServiceRow[], Error>({
    queryKey: doctorServicesKey(doctorId),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/${doctorId}/services`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorServiceRow[] };
      return j.rows;
    },
    staleTime: 30_000,
  });

  // Build baseline state whenever either query resolves. The baseline is
  // what the server currently knows; local edits diverge until Save.
  const baseline = React.useMemo<Record<string, AssignmentState>>(() => {
    const all = servicesQuery.data ?? [];
    const current = doctorServicesQuery.data ?? [];
    const currentMap = new Map(current.map((r) => [r.serviceId, r]));
    const next: Record<string, AssignmentState> = {};
    for (const s of all) {
      const row = currentMap.get(s.id);
      next[s.id] = {
        assigned: Boolean(row),
        priceInput:
          row?.priceOverride != null ? String(tiyinToSum(row.priceOverride)) : "",
        durationInput:
          row?.durationMinOverride != null
            ? String(row.durationMinOverride)
            : "",
      };
    }
    // Preserve any inactive-but-still-assigned services so user can unassign.
    for (const r of current) {
      if (!next[r.serviceId]) {
        next[r.serviceId] = {
          assigned: true,
          priceInput:
            r.priceOverride != null ? String(tiyinToSum(r.priceOverride)) : "",
          durationInput:
            r.durationMinOverride != null
              ? String(r.durationMinOverride)
              : "",
        };
      }
    }
    return next;
  }, [servicesQuery.data, doctorServicesQuery.data]);

  // Local editor state keyed by serviceId. Starts from the baseline: on a
  // remount over cached queries the data is already here on the first
  // render, and an empty start showed every box unticked with Save enabled.
  const [state, setState] = React.useState<Record<string, AssignmentState>>(
    () => baseline,
  );

  // A refetch (window focus, stale time) used to copy the server state over
  // unsaved edits (DR-10). Adopt the new baseline only while the editor still
  // shows the previous one untouched. Null until the first sync, which always
  // adopts (see adoptBaseline).
  const prevBaselineRef = React.useRef<Record<string, AssignmentState> | null>(
    null,
  );
  React.useEffect(() => {
    const prev = prevBaselineRef.current;
    prevBaselineRef.current = baseline;
    setState((cur) => adoptBaseline(cur, prev, baseline));
  }, [baseline]);

  const dirty = React.useMemo(
    () => !assignmentsEqual(state, baseline),
    [state, baseline],
  );

  // Rows that cannot be saved as typed. Save stays disabled until they are
  // fixed: skipping them would unlink the service (the PUT replaces the set).
  const problems = React.useMemo(() => {
    const out: Record<string, ReturnType<typeof rowProblem>> = {};
    for (const [id, row] of Object.entries(state)) {
      const p = rowProblem(row);
      if (p) out[id] = p;
    }
    return out;
  }, [state]);
  const hasProblems = Object.keys(problems).length > 0;

  const selectedCount = React.useMemo(
    () => Object.values(state).filter((s) => s.assigned).length,
    [state],
  );

  const saveMutation = useMutation<void, Error, AssignmentPayload[]>({
    mutationFn: async (assignments) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}/services`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          orphanedServices?: { nameRu: string; nameUz: string }[];
        } | null;
        // The service would be left with no doctor at all (DR-07): name it.
        if (j?.reason === "service_orphaned") {
          const names = (j.orphanedServices ?? [])
            .map((s) => (locale === "uz" ? s.nameUz : s.nameRu))
            .filter(Boolean)
            .join(", ");
          throw new Error(t("orphanedServices", { services: names }));
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: doctorServicesKey(doctorId) });
      qc.invalidateQueries({ queryKey: doctorKey(doctorId) });
      toast.success(t("saved"));
    },
    onError: (e) => {
      toast.error(e.message || tToast("saveFailed"), { duration: 10_000 });
    },
  });

  const handleToggle = (serviceId: string, checked: boolean) => {
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        assigned: checked,
        priceInput: prev[serviceId]?.priceInput ?? "",
        durationInput: prev[serviceId]?.durationInput ?? "",
      },
    }));
  };

  const handlePriceChange = (serviceId: string, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        assigned: prev[serviceId]?.assigned ?? true,
        priceInput: value,
        durationInput: prev[serviceId]?.durationInput ?? "",
      },
    }));
  };

  const handleDurationChange = (serviceId: string, value: string) => {
    if (value !== "" && !/^\d+$/.test(value)) return;
    setState((prev) => ({
      ...prev,
      [serviceId]: {
        assigned: prev[serviceId]?.assigned ?? true,
        priceInput: prev[serviceId]?.priceInput ?? "",
        durationInput: value,
      },
    }));
  };

  const handleReset = () => setState(baseline);

  const handleSave = () => {
    const built = buildAssignments(state);
    if (!built.ok) {
      toast.error(t("invalidRows"));
      return;
    }
    saveMutation.mutate(built.assignments);
  };

  const isLoading = servicesQuery.isLoading || doctorServicesQuery.isLoading;
  const isError = servicesQuery.isError || doctorServicesQuery.isError;

  const services = servicesQuery.data ?? [];

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("selectedCount", { count: selectedCount })}
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!dirty || saveMutation.isPending}
            >
              <RotateCcwIcon className="size-4" />
              {t("reset")}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || hasProblems || saveMutation.isPending}
            >
              <SaveIcon className="size-4" />
              {saveMutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t("loadError")}
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {services.map((s) => {
            const row = state[s.id];
            const checked = Boolean(row?.assigned);
            const priceInput = row?.priceInput ?? "";
            const durationInput = row?.durationInput ?? "";
            const inputId = `svc-${s.id}`;
            const priceId = `price-${s.id}`;
            const durationId = `dur-${s.id}`;
            const problem = problems[s.id];
            return (
              <li
                key={s.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5"
              >
                <div className="flex items-center">
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={!canEdit || saveMutation.isPending}
                    onCheckedChange={(v) =>
                      handleToggle(s.id, v === true)
                    }
                    aria-label={t("assign")}
                  />
                </div>
                <Label
                  htmlFor={inputId}
                  className="flex min-w-0 flex-col gap-0.5 text-sm"
                >
                  <span className="truncate font-medium text-foreground">
                    {locale === "uz" ? s.nameUz : s.nameRu}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.code} · {s.durationMin} min ·{" "}
                    {t("basePrice")}: {fmtUzs(s.priceBase, locale as Locale)}
                  </span>
                </Label>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={priceId}
                      className="text-xs text-muted-foreground"
                    >
                      {t("priceOverride")}
                    </Label>
                    <Input
                      id={priceId}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder={String(tiyinToSum(s.priceBase))}
                      value={priceInput}
                      onChange={(e) =>
                        handlePriceChange(s.id, e.target.value)
                      }
                      disabled={
                        !canEdit || !checked || saveMutation.isPending
                      }
                      aria-invalid={problem?.price || undefined}
                      className="h-8 w-[120px]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={durationId}
                      className="text-xs text-muted-foreground"
                    >
                      {t("durationOverride")}
                    </Label>
                    <Input
                      id={durationId}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder={String(s.durationMin)}
                      value={durationInput}
                      onChange={(e) =>
                        handleDurationChange(s.id, e.target.value)
                      }
                      disabled={
                        !canEdit || !checked || saveMutation.isPending
                      }
                      aria-invalid={problem?.duration || undefined}
                      className="h-8 w-[80px]"
                    />
                  </div>
                  {problem ? (
                    <p className="w-full text-xs text-destructive">
                      {problem.duration
                        ? t("durationRange", {
                            min: DOCTOR_SERVICE_DURATION_MIN,
                            max: DOCTOR_SERVICE_DURATION_MAX,
                          })
                        : t("priceInvalid")}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
