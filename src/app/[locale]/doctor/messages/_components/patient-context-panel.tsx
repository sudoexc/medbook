"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  ShieldAlertIcon,
  TagIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { useMessagesContext } from "../_hooks/messages-context";
import {
  flattenConversations,
  useDoctorConversations,
} from "../_hooks/use-conversations";

type PatientSummary = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string | null;
  birthDate: string | null;
  segment: string | null;
  allergies: Array<{ id: string; substance: string; severity: string }>;
  chronicConditions: Array<{ id: string; name: string }>;
  upcomingAppointment: {
    id: string;
    date: string;
    status: string;
    doctor: { id: string; nameRu: string | null; nameUz: string | null } | null;
  } | null;
  lastDocument: {
    id: string;
    title: string;
    type: string;
    createdAt: string;
  } | null;
};

function ageFromBirth(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const md = now.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < b.getDate())) years -= 1;
  return years >= 0 ? years : null;
}

export function PatientContextPanel() {
  const { selectedId, filters } = useMessagesContext();
  const router = useRouter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";

  const convQuery = useDoctorConversations(filters);
  const conversations = flattenConversations(convQuery.data);
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const patientId = selected?.patient?.id ?? null;

  const summaryQuery = useQuery<PatientSummary>({
    queryKey: ["doctor", "messages", "patient-summary", patientId],
    enabled: !!patientId,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/doctors/me/patients/${patientId}/summary`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`summary ${res.status}`);
      return (await res.json()) as PatientSummary;
    },
  });

  const summary = summaryQuery.data ?? null;
  const age = ageFromBirth(summary?.birthDate ?? null);

  return (
    <aside className="hidden w-[320px] shrink-0 flex-col gap-3 xl:flex">
      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-4">
        <header className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2">
            <TagIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">
              Контекст пациента
            </span>
          </div>
        </header>

        {!patientId ? (
          <p className="text-xs text-muted-foreground">
            Этот диалог не связан с пациентом
          </p>
        ) : summaryQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Загружаем…</p>
        ) : summaryQuery.isError || !summary ? (
          <p className="text-xs text-destructive">Ошибка загрузки</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                router.push(`/${locale}/doctor/visits/${summary.id}`)
              }
              className="group flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/40"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {summary.fullName}
                </div>
                <div className="truncate text-xs text-muted-foreground tabular-nums">
                  {age !== null ? `${age} лет` : "возраст —"} ·{" "}
                  {summary.phone}
                </div>
              </div>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>

            <Row
              icon={ShieldAlertIcon}
              tone={
                summary.allergies.length === 0
                  ? "text-muted-foreground"
                  : summary.allergies.some((a) => a.severity === "SEVERE")
                    ? "text-destructive"
                    : "text-warning"
              }
              label="Аллергии"
              value={
                summary.allergies.length === 0
                  ? "не указано"
                  : summary.allergies.map((a) => a.substance).join(", ")
              }
            />

            <Row
              icon={ClipboardListIcon}
              tone={
                summary.chronicConditions.length === 0
                  ? "text-muted-foreground"
                  : "text-warning"
              }
              label="Хронические"
              value={
                summary.chronicConditions.length === 0
                  ? "не указано"
                  : summary.chronicConditions.map((c) => c.name).join(", ")
              }
            />

            {summary.upcomingAppointment ? (
              <Row
                icon={CalendarIcon}
                tone="text-info"
                label="Следующий приём"
                value={new Date(
                  summary.upcomingAppointment.date,
                ).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              />
            ) : (
              <Row
                icon={CalendarIcon}
                tone="text-muted-foreground"
                label="Следующий приём"
                value="не назначен"
              />
            )}

            {summary.lastDocument ? (
              <Row
                icon={FileTextIcon}
                tone="text-foreground"
                label="Последний документ"
                value={summary.lastDocument.title}
              />
            ) : null}
          </>
        )}
      </section>
    </aside>
  );
}

function Row({
  icon: Icon,
  tone,
  label,
  value,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} />
      <div className="min-w-0">
        <div className="font-semibold text-foreground">{label}</div>
        <div className="text-muted-foreground">{value}</div>
      </div>
    </div>
  );
}
