"use client";

import * as React from "react";
import { Loader2Icon, PillIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  flattenPrescriptions,
  useDoctorPatientPrescriptions,
} from "../../_hooks/use-doctor-patient-prescriptions";

const RU_MONTHS_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-success/15 text-success",
  PAUSED: "bg-warning/15 text-warning",
  COMPLETED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-destructive/10 text-destructive",
};

export function PrescriptionsSection({ patientId }: { patientId: string }) {
  const [status, setStatus] = React.useState<"active" | "all">("active");
  const list = useDoctorPatientPrescriptions(patientId, { status });
  const rows = flattenPrescriptions(list.data);

  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          list.hasNextPage &&
          !list.isFetchingNextPage
        ) {
          list.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [list]);

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex self-start rounded-xl border border-border bg-card p-0.5">
        <TabBtn active={status === "active"} onClick={() => setStatus("active")}>
          Активные
        </TabBtn>
        <TabBtn active={status === "all"} onClick={() => setStatus("all")}>
          Все
        </TabBtn>
      </div>

      {list.isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 animate-spin" />
          Загружаем назначения…
        </div>
      ) : list.isError ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">
          Не удалось загрузить назначения.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {status === "active"
            ? "Активных назначений нет."
            : "Назначений пока нет."}
        </div>
      ) : (
        <section className="rounded-2xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <PillIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {r.drugName}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        STATUS_BADGE[r.status] ??
                          "bg-muted text-muted-foreground",
                      )}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {r.dosage}
                  </div>
                  {r.notes ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.notes}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                    Назначено {ruDate(r.createdAt)}
                    {r.remindersEnabled ? " · напоминания вкл." : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div ref={sentinel} />
          {list.isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Загружаем ещё…
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
