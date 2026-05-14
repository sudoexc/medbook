"use client";

import * as React from "react";

import type { DoctorPatientSummary } from "../../_hooks/use-doctor-patient-summary";

const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function ruDateTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}

export function OverviewSection({ summary }: { summary: DoctorPatientSummary }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Контакты</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Имя" value={summary.fullName} />
          <Row label="Телефон" value={summary.phone} mono />
          {summary.birthDate ? (
            <Row label="Дата рождения" value={ruDateTime(summary.birthDate).split(",")[0] ?? "—"} mono />
          ) : null}
          {summary.segment ? <Row label="Сегмент" value={summary.segment} /> : null}
        </dl>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          Следующий приём
        </h2>
        {summary.upcomingAppointment ? (
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="font-medium tabular-nums text-foreground">
              {ruDateTime(summary.upcomingAppointment.date)}
            </div>
            <div className="text-muted-foreground">
              Статус: {summary.upcomingAppointment.status}
            </div>
            {summary.upcomingAppointment.doctor ? (
              <div className="text-muted-foreground">
                {summary.upcomingAppointment.doctor.nameRu ??
                  summary.upcomingAppointment.doctor.nameUz ??
                  ""}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Запланированных приёмов нет.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Аллергии</h2>
        {summary.allergies.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Не указаны.</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {summary.allergies.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span className="text-foreground">{a.substance}</span>
                <span className="text-xs uppercase text-muted-foreground">
                  {a.severity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          Хронические заболевания
        </h2>
        {summary.chronicConditions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Не указаны.</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm text-foreground">
            {summary.chronicConditions.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
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
    <div className="grid grid-cols-[140px_1fr] items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          mono ? "font-medium text-foreground tabular-nums" : "text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}
