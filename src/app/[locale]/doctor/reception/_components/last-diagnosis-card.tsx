"use client";

import { MOCK_LAST_DIAGNOSIS } from "../_mocks";

export function LastDiagnosisCard() {
  const d = MOCK_LAST_DIAGNOSIS;
  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 text-[15px] font-semibold text-foreground">
        Последний диагноз
      </div>

      <div className="text-sm font-bold text-foreground">
        <span className="tabular-nums">{d.code}</span> {d.name}
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <Row label="Установлен" value={d.setOnDate} />
        <Row label="Статус" value={d.status} />
      </div>

      <button
        type="button"
        className="mt-4 inline-flex w-full items-center justify-center rounded-lg py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5"
      >
        Смотреть все диагнозы
      </button>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
