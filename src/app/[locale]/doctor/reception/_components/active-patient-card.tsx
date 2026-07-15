"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  FilesIcon,
  Loader2Icon,
  MinusIcon,
  PhoneIcon,
  PrinterIcon,
  SquareCheckIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useReceptionContext } from "../_hooks/reception-context";
import { usePreviousVisit } from "../_hooks/use-previous-visit";
import {
  useFinalizeVisitNote,
  usePatchVisitNote,
  useVisitNote,
  type VisitNotePatch,
  type VisitNoteRow,
} from "../_hooks/use-visit-note";

function ageFromBirth(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) y -= 1;
  return y >= 0 ? y : null;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function formatRange(date: string, end: string): string {
  const d = new Date(date);
  const e = new Date(end);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = d.toLocaleString("ru-RU", { day: "numeric", month: "short" });
  return `${day}, ${pad(d.getHours())}:${pad(d.getMinutes())} – ${pad(
    e.getHours(),
  )}:${pad(e.getMinutes())}`;
}

function useElapsed(startedAt: string | null): string {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "—";
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 1000),
  );
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function ActivePatientCard() {
  const t = useTranslations("doctor.reception");
  const { activeAppointment, visitNoteId } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const finalize = useFinalizeVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const previousQuery = usePreviousVisit(visitNoteId);
  const previous = previousQuery.data ?? null;
  const elapsed = useElapsed(activeAppointment?.startedAt ?? null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  if (!activeAppointment) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-bold text-foreground">
          {t("activePatient.noActiveTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("activePatient.noActiveHint")}
        </p>
      </section>
    );
  }

  const p = activeAppointment.patient;
  const age = ageFromBirth(
    (p as unknown as { birthDate?: string | null }).birthDate ?? null,
  );
  const note = noteQuery.data;
  const isFinalized = note?.status === "FINALIZED";

  // Ф0 — finalize gate. No diagnosis → button stays disabled (the API
  // backstops with 400 DIAGNOSIS_REQUIRED). Empty sections don't block but
  // must be explicitly confirmed so an empty conclusion is never an accident.
  const hasDiagnosis = Boolean(note?.diagnosisCode);
  const emptySections = !note
    ? []
    : [
        note.complaints.length === 0 ? t("activePatient.emptyComplaints") : null,
        note.advice.length === 0 ? t("activePatient.emptyAdvice") : null,
        !note.patientHandoutMarkdown?.trim()
          ? t("activePatient.emptyHandout")
          : null,
      ].filter((s): s is string => s !== null);

  const doFinalize = async () => {
    if (!visitNoteId || finalize.isPending || isFinalized) return;
    await finalize.mutateAsync();
  };

  const onFinalize = async () => {
    if (!visitNoteId || finalize.isPending || isFinalized || !hasDiagnosis) return;
    if (emptySections.length > 0) {
      setConfirmOpen(true);
      return;
    }
    await doFinalize();
  };

  // Print endpoint returns self-contained HTML with a sticky print bar.
  // We open it in a new tab so the editor state isn't lost; the doctor
  // hits Cmd/Ctrl+P (or the button in the HTML) to land a PDF. No ?lang —
  // Ф5: the route defaults to the patient's preferredLang, and the page
  // itself has a RU/UZ switcher.
  const onPrint = () => {
    if (!visitNoteId) return;
    window.open(
      `/api/crm/visit-notes/${visitNoteId}/print`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  // Ф5 — one button prints the whole visit package: conclusion + handout +
  // issued e-prescriptions + referrals, page-broken for a single Cmd+P.
  const onPrintPackage = () => {
    if (!visitNoteId) return;
    window.open(
      `/api/crm/visit-notes/${visitNoteId}/print?type=package`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-4 px-5 py-4 lg:gap-6">
        <div className="flex min-w-[240px] items-center gap-3">
          <AvatarWithStatus initials={initials(p.fullName)} size="lg" status="online" />
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-foreground">
              {p.fullName}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="font-medium text-success">
                {isFinalized
                  ? t("activePatient.visitFinished")
                  : t("activePatient.activePatient")}
              </span>
            </div>
          </div>
        </div>

        {age !== null && (
          <MetaCell label={t("activePatient.ageLabel")}>
            <span className="tabular-nums">{t("activePatient.ageYears", { age })}</span>
          </MetaCell>
        )}
        <MetaCell label={t("activePatient.phoneLabel")}>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {p.phone}
            <PhoneIcon className="size-3.5 text-muted-foreground" />
          </span>
        </MetaCell>
        <MetaCell label={t("activePatient.typeLabel")}>
          {activeAppointment.primaryService?.nameRu ?? t("common.consultation")}
        </MetaCell>
        <MetaCell label={t("activePatient.scheduledLabel")}>
          <div className="tabular-nums">
            {formatRange(activeAppointment.date, activeAppointment.endDate)}
          </div>
          {activeAppointment.cabinet?.number && (
            <div className="text-xs text-muted-foreground">
              {t("activePatient.cabinet", { number: activeAppointment.cabinet.number })}
            </div>
          )}
        </MetaCell>
      </div>

      {note && note.diagnosisCode && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-sm">
          <div className="inline-flex min-w-0 items-center gap-1.5">
            <AlertTriangleIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold text-foreground">{t("activePatient.diagnosisLabel")}</span>
            <span className="truncate text-muted-foreground">
              {note.diagnosisCode} · {note.diagnosisName}
            </span>
          </div>
          {note.documentNumber && (
            <div className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-foreground">
                {t("activePatient.docNumber")}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {note.documentNumber}
              </span>
            </div>
          )}
        </div>
      )}

      {note && previous && (!isFinalized || note.dynamics) && (
        <DynamicsRow
          note={note}
          previousFinalizedAt={previous.finalizedAt}
          disabled={isFinalized}
          onChange={(p) => patch.mutate(p)}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
        <span
          title={
            note && !hasDiagnosis && !isFinalized
              ? t("activePatient.finalizeNeedsDiagnosis")
              : undefined
          }
        >
          <Button
            type="button"
            size="lg"
            disabled={
              !visitNoteId ||
              !note ||
              finalize.isPending ||
              isFinalized ||
              !hasDiagnosis
            }
            onClick={onFinalize}
          >
            {finalize.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SquareCheckIcon className="size-4" />
            )}
            {isFinalized
              ? t("activePatient.visitFinished")
              : t("activePatient.finishVisit")}
          </Button>
        </span>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onPrint}
          disabled={!visitNoteId}
        >
          <PrinterIcon className="size-4 text-muted-foreground" />
          {t("activePatient.print")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onPrintPackage}
          disabled={!visitNoteId}
        >
          <FilesIcon className="size-4 text-muted-foreground" />
          {t("activePatient.printPackage")}
        </Button>

        <div className="ml-auto inline-flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("activePatient.visitMode")}
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 text-sm">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="text-foreground">{t("common.consultation")}</span>
              <span className="font-semibold text-success">
                {isFinalized
                  ? t("activePatient.modeFinished")
                  : t("activePatient.modeActive")}
              </span>
            </div>
            <div className="text-base font-bold text-foreground tabular-nums">
              {elapsed}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("activePatient.confirmEmptyTitle")}</DialogTitle>
            <DialogDescription>
              {t("activePatient.confirmEmptyHint")}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5">
            {emptySections.map((section) => (
              <li
                key={section}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <AlertTriangleIcon className="size-4 shrink-0 text-amber-500" />
                {section}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t("activePatient.confirmEmptyCancel")}
            </Button>
            <Button
              type="button"
              disabled={finalize.isPending}
              onClick={async () => {
                setConfirmOpen(false);
                await doFinalize();
              }}
            >
              {t("activePatient.confirmEmptyConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const DYNAMICS_OPTIONS = [
  {
    value: "IMPROVED",
    labelKey: "dynamics.improved",
    Icon: TrendingUpIcon,
    activeCls: "border-success/40 bg-success/10 text-success",
  },
  {
    value: "STABLE",
    labelKey: "dynamics.stable",
    Icon: MinusIcon,
    activeCls: "border-border bg-muted text-foreground",
  },
  {
    value: "WORSE",
    labelKey: "dynamics.worse",
    Icon: TrendingDownIcon,
    activeCls: "border-destructive/40 bg-destructive/10 text-destructive",
  },
] as const;

/**
 * Ф7 — динамика vs прошлый визит. Сегмент-контрол показывается только когда
 * у пациента есть прошлый FINALIZED визит у этого врача; печатается строкой
 * «Динамика: улучшение» в заключении.
 */
function DynamicsRow({
  note,
  previousFinalizedAt,
  disabled,
  onChange,
}: {
  note: VisitNoteRow;
  previousFinalizedAt: string | null;
  disabled: boolean;
  onChange: (patch: VisitNotePatch) => void;
}) {
  const t = useTranslations("doctor.reception");
  const fmt = useFormatter();
  const [noteDraft, setNoteDraft] = React.useState(note.dynamicsNote ?? "");

  React.useEffect(() => {
    setNoteDraft(note.dynamicsNote ?? "");
  }, [note.dynamicsNote]);

  const commitNote = () => {
    const v = noteDraft.trim();
    if (v === (note.dynamicsNote ?? "")) return;
    onChange({ dynamicsNote: v || null });
  };

  const prevDate = previousFinalizedAt ? new Date(previousFinalizedAt) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
      <div className="inline-flex items-center gap-1.5 text-sm">
        <span className="font-semibold text-foreground">
          {t("dynamics.label")}
        </span>
        {prevDate && (
          <span className="text-xs text-muted-foreground">
            {t("dynamics.sinceDate", {
              date: fmt.dateTime(prevDate, { day: "numeric", month: "long" }),
            })}
          </span>
        )}
      </div>
      <div className="inline-flex items-center gap-1">
        {DYNAMICS_OPTIONS.map(({ value, labelKey, Icon, activeCls }) => {
          const active = note.dynamics === value;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ dynamics: active ? null : value })}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:opacity-60",
                active
                  ? activeCls
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3" />
              {t(labelKey)}
            </button>
          );
        })}
      </div>
      {note.dynamics && (
        <input
          type="text"
          disabled={disabled}
          value={noteDraft}
          maxLength={500}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={commitNote}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitNote();
            }
          }}
          placeholder={t("dynamics.notePlaceholder")}
          className="h-7 min-w-[220px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        />
      )}
    </div>
  );
}

function MetaCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 border-l border-border pl-4 lg:pl-6">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}
