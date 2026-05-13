"use client";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MOCK_RECENT_PATIENTS } from "../_mocks";

export function RecentPatients() {
  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-3">
        <div className="text-[15px] font-semibold text-foreground">
          Недавние пациенты
        </div>
      </header>

      <ul className="grid grid-cols-2 gap-2 px-5 pb-3 md:grid-cols-4">
        {MOCK_RECENT_PATIENTS.map((p) => (
          <li
            key={p.id}
            className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/40"
          >
            <AvatarWithStatus src={p.avatarUrl} name={p.shortName} size="lg" />
            <div className="text-center">
              <div className="truncate text-xs font-semibold text-foreground">
                {p.shortName}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {p.date}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <footer className="border-t border-border px-5 py-3">
        <button
          type="button"
          className="motion-press inline-flex w-full items-center justify-center rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
        >
          Все пациенты
        </button>
      </footer>
    </section>
  );
}
