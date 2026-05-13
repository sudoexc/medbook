"use client";

import { PhoneIcon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MOCK_UPCOMING, type UpcomingPatient } from "../_mocks";

const TYPE_LABEL: Record<UpcomingPatient["type"], string> = {
  consultation: "Консультация",
  repeat: "Повторный приём",
};

export function UpcomingPatients() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Ближайшие пациенты
        </div>
      </header>

      <ul className="flex-1 divide-y divide-border/60 px-2">
        {MOCK_UPCOMING.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
          >
            <div className="w-12 shrink-0">
              <div className="text-sm font-semibold tabular-nums text-foreground">
                {p.startTime}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {p.durationMin} мин
              </div>
            </div>
            <AvatarWithStatus src={p.avatarUrl} name={p.shortName} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-foreground">
                {p.shortName}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {TYPE_LABEL[p.type]}
              </div>
            </div>
            <button
              type="button"
              aria-label={`Позвонить ${p.shortName}`}
              className="motion-press flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <PhoneIcon className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Показать всех
        </button>
      </footer>
    </section>
  );
}
