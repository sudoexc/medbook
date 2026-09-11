"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PencilIcon } from "lucide-react";
import { toast } from "sonner";

import {
  doctorPatientSummaryKey,
  type DoctorPatientSummary,
} from "../../_hooks/use-doctor-patient-summary";

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

const fieldCls =
  "h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function OverviewSection({ summary }: { summary: DoctorPatientSummary }) {
  const t = useTranslations("doctor.patients");
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(summary.fullName);
  const [phone, setPhone] = React.useState(summary.phone ?? "");

  const canSave =
    name.trim().length >= 2 &&
    (name.trim() !== summary.fullName || phone.trim() !== (summary.phone ?? ""));

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/patients/${summary.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: name.trim(),
          phone: phone.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("overview.saved"));
      void qc.invalidateQueries({ queryKey: doctorPatientSummaryKey(summary.id) });
      setEditing(false);
    },
    onError: (e: Error) => toast.error(e.message || t("overview.saveFailed")),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            {t("overview.contacts")}
          </h2>
          {/* Name and phone were read-only here, so a number mistyped at
              registration could never be corrected from the doctor's side —
              and the phone is what reminders and the Mini App link depend on. */}
          {!editing ? (
            <button
              type="button"
              onClick={() => {
                setName(summary.fullName);
                setPhone(summary.phone ?? "");
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <PencilIcon className="size-3" />
              {t("overview.edit")}
            </button>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {t("overview.name")}
              </label>
              <input
                type="text"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                className={fieldCls}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {t("overview.phone")}
              </label>
              <input
                type="tel"
                value={phone}
                maxLength={20}
                inputMode="tel"
                onChange={(e) => setPhone(e.target.value)}
                className={fieldCls}
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={!canSave || save.isPending}
                onClick={() => save.mutate()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                {save.isPending ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : null}
                {t("overview.save")}
              </button>
              <button
                type="button"
                disabled={save.isPending}
                onClick={() => setEditing(false)}
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
              >
                {t("overview.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <dl className="mt-3 space-y-2 text-sm">
            <Row label={t("overview.name")} value={summary.fullName} />
            <Row label={t("overview.phone")} value={summary.phone} mono />
            {summary.birthDate ? (
              <Row label={t("overview.birthDate")} value={ruDateTime(summary.birthDate).split(",")[0] ?? "—"} mono />
            ) : null}
            {summary.segment ? (
              <Row label={t("overview.segment")} value={summary.segment} />
            ) : null}
          </dl>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          {t("overview.nextAppointment")}
        </h2>
        {summary.upcomingAppointment ? (
          <div className="mt-3 space-y-1.5 text-sm">
            <div className="font-medium tabular-nums text-foreground">
              {ruDateTime(summary.upcomingAppointment.date)}
            </div>
            <div className="text-muted-foreground">
              {t("overview.statusLabel", {
                status: summary.upcomingAppointment.status,
              })}
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
            {t("overview.noAppointments")}
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">
          {t("overview.allergies")}
        </h2>
        {summary.allergies.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("overview.notSpecified")}
          </p>
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
          {t("overview.chronicConditions")}
        </h2>
        {summary.chronicConditions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("overview.notSpecified")}
          </p>
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
