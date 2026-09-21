"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  FilesIcon,
  MinusIcon,
  PrinterIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { Button } from "@/components/ui/button";

import { ticketNumberFor } from "@/server/services/ticket-number";
import { useReceptionContext } from "../_hooks/reception-context";
import { usePreviousVisit } from "../_hooks/use-previous-visit";
import { EditablePhone } from "./editable-phone";
import { TelegramSendPanel } from "../../_components/telegram-send-panel";
import {
  isVersionConflict,
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

/** Wall-clock moment, no range — used for "joined the queue at". */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = d.toLocaleString("ru-RU", { day: "numeric", month: "short" });
  return `${day}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const {
    activeAppointment,
    visitNoteId,
  } = useReceptionContext();
  const noteQuery = useVisitNote(visitNoteId);
  const patch = usePatchVisitNote(visitNoteId);
  const previousQuery = usePreviousVisit(visitNoteId);
  const previous = previousQuery.data ?? null;
  const elapsed = useElapsed(activeAppointment?.startedAt ?? null);

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
  // Two-lanes: the live lane has no appointment time, only a join moment.
  const isWalkin = activeAppointment.channel === "WALKIN";


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

        {/* The paper ticket — how the doctor calls the patient out loud.
            Pure derivation, same formula as every queue surface. */}
        {(() => {
          const ticket = ticketNumberFor(
            activeAppointment.doctor.id,
            activeAppointment.ticketSeq ?? activeAppointment.queueOrder,
          );
          return ticket ? (
            <MetaCell label={t("activePatient.ticketLabel")}>
              <span className="font-bold tabular-nums text-primary">{ticket}</span>
            </MetaCell>
          ) : null;
        })()}
        {age !== null && (
          <MetaCell label={t("activePatient.ageLabel")}>
            <span className="tabular-nums">{t("activePatient.ageYears", { age })}</span>
          </MetaCell>
        )}
        <MetaCell label={t("activePatient.phoneLabel")}>
          {/* Correctable in place: a digit mistyped at registration is noticed
              here, with the patient present, not on a card two screens away. */}
          <EditablePhone patientId={p.id} phone={p.phone ?? null} />
        </MetaCell>
        <MetaCell label={t("activePatient.typeLabel")}>
          {activeAppointment.primaryService?.nameRu ?? t("common.consultation")}
        </MetaCell>
        {/* A walk-in has no scheduled slot — the 30-minute range exists only
            because the row needs a start and an end in the database. Showing
            it as «ЗАПЛАНИРОВАНО 15:24 – 15:54» invents a commitment nobody
            made: the live lane runs at whatever pace the day has, five in an
            hour or one. Show when they joined the queue instead. */}
        <MetaCell
          label={
            isWalkin
              ? t("activePatient.queuedLabel")
              : t("activePatient.scheduledLabel")
          }
        >
          <div className="tabular-nums">
            {isWalkin
              ? formatTime(activeAppointment.queuedAt ?? activeAppointment.date)
              : formatRange(activeAppointment.date, activeAppointment.endDate)}
          </div>
          {activeAppointment.cabinet?.number && (
            <div className="text-xs text-muted-foreground">
              {t("activePatient.cabinet", { number: activeAppointment.cabinet.number })}
            </div>
          )}
        </MetaCell>
      </div>


      {note && (note.diagnosisCode || note.diagnosisName) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-sm">
          <div className="inline-flex min-w-0 items-center gap-1.5">
            <AlertTriangleIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold text-foreground">{t("activePatient.diagnosisLabel")}</span>
            <span className="truncate text-muted-foreground">
              {[note.diagnosisCode, note.diagnosisName].filter(Boolean).join(" · ")}
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
          onChange={(p) =>
            // Dynamics is part of the clinical record too — a silent failure
            // here would leave the doctor believing the assessment is saved.
            patch.mutate(p, {
              onError: (e) =>
                toast.error(
                  isVersionConflict(e)
                    ? t("editor.saveErrorConflict")
                    : t("structured.saveErrorGeneric"),
                ),
            })
          }
        />
      )}

      {/* Sign-off moved to the sticky VisitActionBar at the end of the
          flow — this row keeps the document actions only. */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
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
        {/* The Telegram half of «отдать документы»: link the patient by QR
            right at the desk if needed, then push the visit's files to their
            chat. Print stays for paper people; this is for everyone else. */}
        {visitNoteId ? (
          <TelegramSendPanel patientId={p.id} visitNoteId={visitNoteId} />
        ) : null}

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
