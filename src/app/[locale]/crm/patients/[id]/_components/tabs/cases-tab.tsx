"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronRightIcon,
  ClipboardListIcon,
  PlusIcon,
  StethoscopeIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/atoms/empty-state";
import { SkeletonRow } from "@/components/atoms/skeleton-row";

import type { Patient } from "../../_hooks/use-patient";
import {
  usePatientCases,
  useCreateCase,
  type CaseStatus,
  type PatientCase,
} from "../../_hooks/use-patient-cases";

type FilterKey = "all" | "open" | "closed";

const FILTERS: { key: FilterKey; tKey: "filterAll" | "filterOpen" | "filterClosed" }[] = [
  { key: "all", tKey: "filterAll" },
  { key: "open", tKey: "filterOpen" },
  { key: "closed", tKey: "filterClosed" },
];

const STATUS_VARIANT: Record<
  CaseStatus,
  "default" | "success" | "warning" | "muted"
> = {
  OPEN: "default",
  RESOLVED: "success",
  TRANSFERRED: "warning",
  ABANDONED: "muted",
};

function statusKey(s: CaseStatus): "statusOpen" | "statusResolved" | "statusAbandoned" | "statusTransferred" {
  switch (s) {
    case "OPEN":
      return "statusOpen";
    case "RESOLVED":
      return "statusResolved";
    case "ABANDONED":
      return "statusAbandoned";
    case "TRANSFERRED":
      return "statusTransferred";
  }
}

export interface CasesTabProps {
  patient: Patient;
}

export function CasesTab({ patient }: CasesTabProps) {
  const t = useTranslations("patientCard.cases");
  const locale = useLocale() as Locale;
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [createOpen, setCreateOpen] = React.useState(false);
  // Hash deep-link target — set when the URL is `#case-<id>`. The Cases tab
  // only mounts when the user is on it (lazy-loaded), so an effect here is
  // enough to scroll-into-view + briefly highlight on first paint and on
  // subsequent hashchanges without polluting the parent.
  const [highlightId, setHighlightId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const apply = () => {
      const h =
        typeof window !== "undefined" ? window.location.hash : "";
      const match = h.match(/^#case-(.+)$/);
      setHighlightId(match ? match[1]! : null);
    };
    apply();
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", apply);
      return () => window.removeEventListener("hashchange", apply);
    }
  }, []);

  const q = usePatientCases(patient.id, { status: filter });
  const rows = q.data?.rows ?? [];

  // Counts come from the unfiltered list; we always fetch "all" alongside the
  // filtered list to render the header badge ("3 открытых · 12 закрытых")
  // regardless of which chip is active. Cheap because the API is small.
  const allQ = usePatientCases(patient.id, { status: "all" });
  const allRows = allQ.data?.rows ?? [];
  const openCount = allRows.filter((r) => r.status === "OPEN").length;
  const closedCount = allRows.length - openCount;

  // OPEN-first ordering when filter === "all" (per spec: "show OPEN first,
  // RESOLVED/ABANDONED/TRANSFERRED collapsed below").
  const ordered = React.useMemo(() => {
    if (filter !== "all") return rows;
    const open: PatientCase[] = [];
    const closed: PatientCase[] = [];
    for (const r of rows) {
      if (r.status === "OPEN") open.push(r);
      else closed.push(r);
    }
    return [...open, ...closed];
  }, [rows, filter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold text-foreground">
            {t("tabTitle")}
          </h2>
          {allQ.isLoading ? null : (
            <p className="text-xs text-muted-foreground">
              {t("counts", { open: openCount, closed: closedCount })}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" />
          {t("newCase")}
        </Button>
      </div>

      <div
        role="tablist"
        aria-label={t("tabTitle")}
        className="inline-flex w-fit gap-1 rounded-lg bg-muted/50 p-0.5 text-xs"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(f.tKey)}
            </button>
          );
        })}
      </div>

      {q.isLoading ? (
        <div className="rounded-xl border border-border bg-card p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} cols={3} />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title={t("empty")}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="size-4" />
              {t("emptyCta")}
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {ordered.map((row) => (
            <CaseCard
              key={row.id}
              row={row}
              locale={locale}
              t={t}
              highlight={highlightId === row.id}
            />
          ))}
        </ul>
      )}

      <CreateCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        patient={patient}
      />
    </div>
  );
}

type CasesT = ReturnType<typeof useTranslations>;

function CaseCard({
  row,
  locale,
  t,
  highlight,
}: {
  row: PatientCase;
  locale: Locale;
  t: CasesT;
  highlight: boolean;
}) {
  const isOpen = row.status === "OPEN";
  const variant = STATUS_VARIANT[row.status];
  const sKey = statusKey(row.status);
  const doctor = row.primaryDoctor;
  const doctorName = doctor
    ? locale === "uz"
      ? doctor.nameUz
      : doctor.nameRu
    : null;
  const visits = row._count?.appointments ?? 0;

  // Scroll the matched card into view + briefly pulse the border so the
  // user can see which card the deep-link landed on. The effect runs on
  // every `highlight` flip so consecutive `#case-X` → `#case-Y` jumps both
  // animate.
  const ref = React.useRef<HTMLLIElement | null>(null);
  React.useEffect(() => {
    if (highlight && ref.current) {
      ref.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight]);

  // Card is now a Link to the standalone detail page (#220). The whole row
  // is wrapped so chevron + body share the same hit-target.
  return (
    <li
      ref={ref}
      id={`case-${row.id}`}
      className={cn(
        "group rounded-xl border bg-card p-3 transition-all",
        isOpen
          ? "border-border shadow-sm hover:border-primary/40 hover:shadow"
          : "border-border/60 bg-muted/20 opacity-90",
        highlight && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
      )}
    >
      <Link
        href={`/${locale}/crm/cases/${row.id}`}
        className="flex items-start gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-md"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={cn(
                "truncate text-sm font-semibold",
                isOpen ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {row.title}
            </h3>
            <Badge variant={variant}>{t(sKey)}</Badge>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground tabular-nums">
            <span>
              {t("opened")}: {formatDate(row.openedAt, locale, "short")}
            </span>
            {row.closedAt ? (
              <span>
                {t("closed")}: {formatDate(row.closedAt, locale, "short")}
              </span>
            ) : null}
            <span>{t("visits", { count: visits })}</span>
          </div>

          <div className="mt-2 flex items-center gap-2">
            {doctor ? (
              <>
                <Avatar className="size-6">
                  <AvatarImage alt={doctorName ?? ""} />
                  <AvatarFallback className="text-[10px]">
                    {(doctorName ?? "?")
                      .split(" ")
                      .map((s) => s[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-xs text-foreground">
                  {doctorName}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <StethoscopeIcon className="size-3.5" />
                {t("noPrimaryDoctor")}
              </span>
            )}
          </div>

          {row.primaryComplaint ? (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              {row.primaryComplaint}
            </p>
          ) : null}
        </div>

        <ChevronRightIcon
          className={cn(
            "mt-1 size-4 shrink-0 text-muted-foreground transition-transform",
            "group-hover:translate-x-0.5",
          )}
          aria-hidden
        />
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Create Case dialog (inline so the tab stays self-contained).
// ---------------------------------------------------------------------------

type DoctorOption = {
  id: string;
  nameRu: string;
  nameUz: string;
  isActive: boolean;
};

function useDoctorsForDialog(open: boolean) {
  return useQuery<DoctorOption[], Error>({
    queryKey: ["doctors", "case-create"],
    enabled: open,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: DoctorOption[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
}

function CreateCaseDialog({
  open,
  onOpenChange,
  patient,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patient: Patient;
}) {
  const t = useTranslations("patientCard.cases");
  const locale = useLocale() as Locale;
  const [title, setTitle] = React.useState("");
  const [doctorId, setDoctorId] = React.useState<string>("");
  const [complaint, setComplaint] = React.useState("");

  React.useEffect(() => {
    if (!open) {
      setTitle("");
      setDoctorId("");
      setComplaint("");
    }
  }, [open]);

  const doctorsQ = useDoctorsForDialog(open);
  const create = useCreateCase();

  const canSubmit = title.trim().length > 0 && !create.isPending;

  const submit = async () => {
    if (!canSubmit) return;
    try {
      await create.mutateAsync({
        patientId: patient.id,
        title: title.trim(),
        primaryDoctorId: doctorId ? doctorId : null,
        primaryComplaint: complaint.trim() ? complaint.trim() : null,
      });
      toast.success(t("created"));
      onOpenChange(false);
    } catch {
      // useCreateCase already surfaces the error toast.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createDialogTitle")}</DialogTitle>
          <DialogDescription>{patient.fullName}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="case-title" className="text-xs font-medium">
              {t("createTitleLabel")}
            </Label>
            <Input
              id="case-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={120}
              required
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="case-doctor" className="text-xs font-medium">
              {t("createDoctorLabel")}
            </Label>
            <Select
              value={doctorId}
              onValueChange={(v) => setDoctorId(v)}
              disabled={doctorsQ.isLoading}
            >
              <SelectTrigger id="case-doctor">
                <SelectValue placeholder={t("noPrimaryDoctor")} />
              </SelectTrigger>
              <SelectContent>
                {(doctorsQ.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {locale === "uz" ? d.nameUz : d.nameRu}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="case-complaint" className="text-xs font-medium">
              {t("createComplaintLabel")}
            </Label>
            <Textarea
              id="case-complaint"
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              rows={4}
              maxLength={5000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            {t("createCancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {create.isPending ? "…" : t("createSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
