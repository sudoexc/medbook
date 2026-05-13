"use client";

import * as React from "react";
import {
  ChevronRightIcon,
  ClockIcon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlayIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MOCK_CURRENT_PATIENT, type PatientTag } from "../_mocks";

const TAG_LABEL: Record<PatientTag, string> = {
  active: "Активный пациент",
  first_visit: "Первичный приём",
  vip: "VIP",
  new: "Новый",
};

const TAG_CLASS: Record<PatientTag, string> = {
  active: "bg-success/15 text-success",
  first_visit: "bg-violet/15 text-violet",
  vip: "bg-warning/15 text-warning",
  new: "bg-info/15 text-info",
};

function formatTimer(totalSec: number) {
  const sign = totalSec < 0 ? "-" : "";
  const abs = Math.abs(totalSec);
  const h = String(Math.floor(abs / 3600)).padStart(2, "0");
  const m = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  const s = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}:${s}`;
}

export function CurrentPatientCard() {
  const p = MOCK_CURRENT_PATIENT;
  const [seconds, setSeconds] = React.useState(p.appointmentSecondsLeft);
  React.useEffect(() => {
    const id = window.setInterval(
      () => setSeconds((s) => s + 1),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-2">
        <div className="text-[15px] font-semibold text-foreground">
          Текущий пациент
        </div>
      </header>

      <div className="flex flex-col gap-3 px-5 pb-3">
        <div className="flex items-start gap-3">
          <AvatarWithStatus
            src={p.avatarUrl}
            name={p.fullName}
            size="lg"
            status="online"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-foreground">
              {p.fullName}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {p.age} лет ({p.birthDate})
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <PhoneIcon className="size-3" />
              <span>{p.phone}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {p.tags.map((tag) => (
            <span
              key={tag}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                TAG_CLASS[tag],
              )}
            >
              {TAG_LABEL[tag]}
            </span>
          ))}
        </div>

        <div className="text-xs text-muted-foreground">{p.appointmentRange}</div>

        <div className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-bold tabular-nums text-primary">
          <ClockIcon className="size-3.5" />
          {formatTimer(seconds)}
        </div>
      </div>

      <div className="mx-5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Жалобы
        </div>
        <div className="mt-1 text-xs leading-relaxed text-foreground">
          {p.complaints}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-5 py-4">
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Последний визит
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground tabular-nums">
            {p.lastVisit.date}
          </div>
          <div className="text-xs text-muted-foreground">
            {p.lastVisit.title}
          </div>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Открыть визит
            <ChevronRightIcon className="size-3" />
          </button>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Последний диагноз
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {p.lastDiagnosis.codes.map((c) => (
              <li key={c.code} className="flex gap-1.5">
                <span className="font-semibold text-foreground tabular-nums">
                  {c.code}
                </span>
                <span className="truncate text-muted-foreground">{c.name}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            Смотреть историю
            <ChevronRightIcon className="size-3" />
          </button>
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex flex-1 items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Открыть карту пациента
        </button>
        <button
          type="button"
          className="motion-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <PlayIcon className="size-4" />
          Начать приём
        </button>
        <button
          type="button"
          aria-label="Ещё действия"
          className="motion-press flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
      </footer>
    </section>
  );
}
