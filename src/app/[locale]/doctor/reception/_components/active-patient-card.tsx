"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  HistoryIcon,
  Loader2Icon,
  PhoneIcon,
  PrinterIcon,
  SquareCheckIcon,
} from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { Button } from "@/components/ui/button";

import { useReceptionContext } from "../_hooks/reception-context";
import { useFinalizeVisitNote, useVisitNote } from "../_hooks/use-visit-note";

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
  const { activeAppointment, visitNoteId } = useReceptionContext();
  const router = useRouter();
  const noteQuery = useVisitNote(visitNoteId);
  const finalize = useFinalizeVisitNote(visitNoteId);
  const elapsed = useElapsed(activeAppointment?.startedAt ?? null);

  if (!activeAppointment) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-base font-bold text-foreground">
          Активный приём отсутствует
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Откройте очередь и нажмите «Начать», чтобы запустить консультацию.
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

  const onFinalize = async () => {
    if (!visitNoteId || finalize.isPending || isFinalized) return;
    await finalize.mutateAsync();
  };

  const onPrint = () => {
    if (!visitNoteId) return;
    // Print endpoint returns self-contained HTML with a sticky print bar.
    // We open it in a new tab so the editor state isn't lost; the doctor
    // hits Cmd/Ctrl+P (or the button in the HTML) to land a PDF.
    window.open(
      `/api/crm/visit-notes/${visitNoteId}/print?lang=ru`,
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
                {isFinalized ? "Приём завершён" : "Активный пациент"}
              </span>
            </div>
          </div>
        </div>

        {age !== null && (
          <MetaCell label="Возраст">
            <span className="tabular-nums">{age} лет</span>
          </MetaCell>
        )}
        <MetaCell label="Телефон">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {p.phone}
            <PhoneIcon className="size-3.5 text-muted-foreground" />
          </span>
        </MetaCell>
        <MetaCell label="Тип приёма">
          {activeAppointment.primaryService?.nameRu ?? "Консультация"}
        </MetaCell>
        <MetaCell label="Запись на">
          <div className="tabular-nums">
            {formatRange(activeAppointment.date, activeAppointment.endDate)}
          </div>
          {activeAppointment.cabinet?.number && (
            <div className="text-xs text-muted-foreground">
              Кабинет {activeAppointment.cabinet.number}
            </div>
          )}
        </MetaCell>
      </div>

      {note && note.diagnosisCode && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-5 py-3 text-sm">
          <div className="inline-flex min-w-0 items-center gap-1.5">
            <AlertTriangleIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-semibold text-foreground">Диагноз:</span>
            <span className="truncate text-muted-foreground">
              {note.diagnosisCode} · {note.diagnosisName}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-4">
        <Button
          type="button"
          size="lg"
          disabled={!visitNoteId || finalize.isPending || isFinalized}
          onClick={onFinalize}
        >
          {finalize.isPending ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <SquareCheckIcon className="size-4" />
          )}
          {isFinalized ? "Приём завершён" : "Завершить приём"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => router.push(`/doctor/patients/${p.id}`)}
        >
          <HistoryIcon className="size-4 text-muted-foreground" />
          Открыть карту
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={onPrint}
          disabled={!visitNoteId}
        >
          <PrinterIcon className="size-4 text-muted-foreground" />
          Печать
        </Button>

        <div className="ml-auto inline-flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Режим приёма
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 text-sm">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="text-foreground">Консультация</span>
              <span className="font-semibold text-success">
                {isFinalized ? "завершена" : "активна"}
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
