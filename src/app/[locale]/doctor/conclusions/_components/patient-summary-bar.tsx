"use client";

import { MoreHorizontalIcon, PhoneIcon, UserSquare2Icon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MOCK_PATIENT_SUMMARY } from "../_mocks";

export function PatientSummaryBar() {
  const p = MOCK_PATIENT_SUMMARY;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center gap-4 lg:gap-6">
        {/* Identity */}
        <div className="flex min-w-[220px] items-center gap-3">
          <AvatarWithStatus initials={p.initials} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-foreground">
              {p.fullName}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs">
              <span className="size-1.5 rounded-full bg-success" />
              <span className="font-medium text-success">{p.statusLabel}</span>
            </div>
          </div>
        </div>

        <MetaCell label="Возраст">
          <span className="tabular-nums">
            {p.age} лет ({p.birthDate})
          </span>
        </MetaCell>

        <MetaCell label="Телефон">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {p.phone}
            <PhoneIcon className="size-3.5 text-muted-foreground" />
          </span>
        </MetaCell>

        <MetaCell label="Последний визит">
          <div>
            <div className="text-sm font-medium text-foreground tabular-nums">
              {p.lastVisit}
            </div>
            <div className="text-xs text-muted-foreground">{p.lastVisitType}</div>
          </div>
        </MetaCell>

        <MetaCell label="Последний диагноз">
          <span className="text-sm text-foreground">
            <span className="font-semibold tabular-nums">{p.lastDiagnosis.code}</span>{" "}
            <span className="text-muted-foreground">{p.lastDiagnosis.name}</span>
          </span>
        </MetaCell>

        {/* Actions */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="motion-press inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <UserSquare2Icon className="size-4 text-muted-foreground" />
            Открыть карту пациента
          </button>
          <button
            type="button"
            aria-label="Ещё"
            className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
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
    <div className="min-w-0 max-w-[260px] border-l border-border pl-4 lg:pl-6">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}
