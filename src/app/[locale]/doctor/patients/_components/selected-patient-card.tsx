"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronRightIcon,
  FileTextIcon,
  MessageSquareIcon,
  PhoneIcon,
} from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { toast } from "sonner";

import { usePatientsFilters } from "../_hooks/patients-context";
import {
  useDoctorPatientSummary,
  type DoctorPatientSummary,
} from "../_hooks/use-doctor-patient-summary";

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

function ruDateTime(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = RU_MONTHS_SHORT[d.getMonth()] ?? "";
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

function ageFromBirth(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const monthDelta = now.getMonth() - b.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < b.getDate())) {
    years -= 1;
  }
  return years >= 0 ? years : null;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return (
    parts
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "?"
  );
}

function statusFromSummary(s: DoctorPatientSummary): {
  label: string;
  tone: "active" | "watch" | "muted";
} {
  if (s.upcomingAppointment?.status === "IN_PROGRESS") {
    return { label: "На приёме", tone: "active" };
  }
  if (s.upcomingAppointment) {
    return { label: "Назначен приём", tone: "watch" };
  }
  return { label: "Активный", tone: "muted" };
}

export function SelectedPatientCard() {
  const { selectedPatientId } = usePatientsFilters();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const router = useRouter();

  const summary = useDoctorPatientSummary(selectedPatientId);

  if (!selectedPatientId) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-6 text-center text-sm text-muted-foreground">
        Выберите пациента из списка слева, чтобы увидеть детали.
      </section>
    );
  }

  if (summary.isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="size-10 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            <div className="h-2 w-20 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-3 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      </section>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-6 text-center text-sm text-destructive">
        Не удалось загрузить пациента.
      </section>
    );
  }

  const p = summary.data;
  const age = ageFromBirth(p.birthDate);
  const detailHref = `/${locale}/doctor/patients/${p.id}`;
  const status = statusFromSummary(p);

  const onWrite = async () => {
    try {
      const res = await fetch(
        "/api/crm/doctors/me/conversations/find-or-create",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId: p.id }),
        },
      );
      if (res.status === 422) {
        toast.error("Нет канала связи с пациентом", {
          description: "Добавьте телефон или Telegram, чтобы написать.",
        });
        return;
      }
      if (!res.ok) {
        toast.error("Не удалось открыть чат");
        return;
      }
      router.push(`/${locale}/doctor/messages?patientId=${p.id}`);
    } catch {
      toast.error("Не удалось открыть чат");
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-3">
        <AvatarWithStatus initials={initials(p.fullName)} size="md" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {p.fullName}
          </div>
          <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs">
            <span
              className={
                status.tone === "active"
                  ? "size-1.5 rounded-full bg-success"
                  : status.tone === "watch"
                    ? "size-1.5 rounded-full bg-info"
                    : "size-1.5 rounded-full bg-muted-foreground/50"
              }
            />
            <span
              className={
                status.tone === "active"
                  ? "font-medium text-success"
                  : status.tone === "watch"
                    ? "font-medium text-info"
                    : "font-medium text-muted-foreground"
              }
            >
              {status.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground tabular-nums">
        {age !== null ? `${age} лет · ` : ""}
        {p.phone}
      </div>

      <div className="mt-4 space-y-2 text-xs">
        {p.upcomingAppointment ? (
          <Row
            label="Следующий приём"
            value={ruDateTime(p.upcomingAppointment.date)}
            mono
          />
        ) : (
          <Row label="Следующий приём" value="—" />
        )}
        {p.allergies.length > 0 ? (
          <Row
            label="Аллергии"
            value={
              <span className="line-clamp-2 text-foreground">
                {p.allergies.map((a) => a.substance).join(", ")}
              </span>
            }
          />
        ) : null}
        {p.chronicConditions.length > 0 ? (
          <Row
            label="Хроника"
            value={
              <span className="line-clamp-2 text-foreground">
                {p.chronicConditions.map((c) => c.name).join(", ")}
              </span>
            }
          />
        ) : null}
        {p.lastDocument ? (
          <Row
            label="Последний документ"
            value={
              <span className="line-clamp-1 text-foreground">
                {p.lastDocument.title}
              </span>
            }
          />
        ) : null}
        {p.segment ? <Row label="Сегмент" value={p.segment} /> : null}
      </div>

      <Link
        href={detailHref}
        className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      >
        Открыть карточку
        <ChevronRightIcon className="size-4" />
      </Link>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <button
          type="button"
          aria-label="Написать"
          title="Написать"
          onClick={onWrite}
          className="flex h-10 items-center justify-center rounded-lg border border-border bg-background text-primary transition-colors hover:bg-primary/5"
        >
          <MessageSquareIcon className="size-4" />
        </button>
        <a
          aria-label="Позвонить"
          title="Позвонить"
          href={`tel:${p.phone}`}
          className="flex h-10 items-center justify-center rounded-lg border border-border bg-background text-primary transition-colors hover:bg-primary/5"
        >
          <PhoneIcon className="size-4" />
        </a>
        <Link
          aria-label="История визитов"
          title="История визитов"
          href={`${detailHref}?tab=visits`}
          className="flex h-10 items-center justify-center rounded-lg border border-border bg-background text-primary transition-colors hover:bg-primary/5"
        >
          <FileTextIcon className="size-4" />
        </Link>
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
