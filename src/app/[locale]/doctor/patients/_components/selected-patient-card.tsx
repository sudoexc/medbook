"use client";

import {
  CalendarPlusIcon,
  FileTextIcon,
  MessageSquareIcon,
  PhoneIcon,
  RefreshCwIcon,
} from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MOCK_SELECTED_PATIENT } from "../_mocks";

const ACTIONS = [
  { key: "schedule", Icon: CalendarPlusIcon, label: "Записать" },
  { key: "message", Icon: MessageSquareIcon, label: "Написать" },
  { key: "call", Icon: PhoneIcon, label: "Позвонить" },
  { key: "note", Icon: FileTextIcon, label: "Заметка" },
] as const;

export function SelectedPatientCard() {
  const p = MOCK_SELECTED_PATIENT;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-3">
        <AvatarWithStatus initials={p.initials} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {p.fullName}
          </div>
          <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs">
            <span className="size-1.5 rounded-full bg-success" />
            <span className="font-medium text-success">{p.statusLabel}</span>
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground tabular-nums">
        {p.age} лет · {p.phone}
      </div>

      <div className="mt-4 space-y-2 text-xs">
        <Row label="Последний визит" value={p.lastVisit} mono />
        <Row
          label="Диагноз"
          value={
            <>
              <span className="font-semibold tabular-nums">{p.diagnosis.code}</span>{" "}
              {p.diagnosis.name}
            </>
          }
        />
        <Row label="Статус" value={p.status} />
        <Row label="Следующий приём" value={p.nextAppointment} mono />
        <Row
          label="Риск no-show"
          value={
            <span className="inline-flex items-center rounded-md bg-success/15 px-1.5 py-0.5 text-[11px] font-semibold text-success">
              {p.risk}
            </span>
          }
        />
      </div>

      <button
        type="button"
        className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <RefreshCwIcon className="size-4" />
        Открыть карточку
      </button>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {ACTIONS.map(({ key, Icon, label }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            className="flex h-10 items-center justify-center rounded-lg border border-border bg-background text-primary transition-colors hover:bg-primary/5"
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          mono
            ? "font-medium text-foreground tabular-nums"
            : "font-medium text-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}
