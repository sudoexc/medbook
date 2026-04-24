"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { formatDate, formatPhone, type Locale } from "@/lib/format";
import { Textarea } from "@/components/ui/textarea";

import {
  type Patient,
  type PatientUpdateInput,
  usePatchPatient,
} from "../_hooks/use-patient";
import type { PatientAppointment } from "../_hooks/use-patient-appointments";
import { TagEditor } from "./tag-editor";

export interface PatientInfoPanelProps {
  patient: Patient;
  appointments: PatientAppointment[];
}

function ageFrom(birthDate: string | null, nowMs: number): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date(nowMs);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/**
 * Left sidebar stack on the patient card — docs/7 - Карточка пациента.png.
 * Cards: Следующая информация / Теги / Заметки.
 */
export function PatientInfoPanel({ patient, appointments }: PatientInfoPanelProps) {
  const locale = useLocale() as Locale;
  const tGender = useTranslations("patients.gender");
  const tSource = useTranslations("patients.source");
  const tPanel = useTranslations("patientCard.infoPanel");
  const tCommon = useTranslations("common");
  const [nowMs] = React.useState(() => Date.now());

  const patch = usePatchPatient(patient.id);
  const save = React.useCallback(
    (input: PatientUpdateInput) => patch.mutateAsync(input),
    [patch],
  );

  const firstVisit = React.useMemo(() => {
    const withDate = appointments
      .filter((a) => !!a.date)
      .map((a) => new Date(a.date).getTime())
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    return withDate[0] ? new Date(withDate[0]).toISOString() : null;
  }, [appointments]);

  const age = ageFrom(patient.birthDate, nowMs);

  const [notesDraft, setNotesDraft] = React.useState(patient.notes ?? "");
  const [isEditingNotes, setEditingNotes] = React.useState(false);

  React.useEffect(() => {
    setNotesDraft(patient.notes ?? "");
  }, [patient.notes]);

  return (
    <div className="flex flex-col gap-3">
      <SidebarCard title={tPanel("mainInfo")} action={tCommon("edit")}>
        <InfoRow label={tPanel("phone")} value={formatPhone(patient.phone)} mono />
        <InfoRow
          label="Telegram"
          value={
            patient.telegramUsername ? `@${patient.telegramUsername}` : "—"
          }
        />
        <InfoRow
          label={tPanel("birthDate")}
          value={
            patient.birthDate
              ? `${formatDate(patient.birthDate, locale, "short")}${age !== null ? ` (${tPanel("ageSuffix", { age })})` : ""}`
              : "—"
          }
        />
        <InfoRow
          label={tPanel("gender")}
          value={
            patient.gender
              ? tGender(patient.gender.toLowerCase() as "male" | "female")
              : "—"
          }
        />
        <InfoRow label={tPanel("address")} value={patient.address ?? "—"} />
        <InfoRow
          label={tPanel("source")}
          value={
            patient.source
              ? tSource(patient.source.toLowerCase() as never)
              : "—"
          }
        />
        <InfoRow
          label={tPanel("firstVisit")}
          value={firstVisit ? formatDate(firstVisit, locale, "short") : "—"}
        />
        <InfoRow label={tPanel("manager")} value="—" />
        <InfoRow
          label={tPanel("preferredLang")}
          value={patient.preferredLang === "UZ" ? tPanel("langUz") : tPanel("langRu")}
        />
        <InfoRow
          label={tPanel("consentMarketing")}
          value={patient.consentMarketing ? tCommon("yes") : tCommon("no")}
        />
      </SidebarCard>

      <SidebarCard title={tPanel("tags")}>
        <TagEditor
          tags={patient.tags}
          onChange={async (next) => {
            await save({ tags: next });
          }}
        />
      </SidebarCard>

      <SidebarCard
        title={tPanel("notes")}
        action={isEditingNotes ? undefined : tCommon("edit")}
        onAction={() => setEditingNotes(true)}
      >
        {isEditingNotes ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={5}
              placeholder={tPanel("notesPlaceholder")}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setNotesDraft(patient.notes ?? "");
                  setEditingNotes(false);
                }}
              >
                {tCommon("cancel")}
              </button>
              <button
                type="button"
                className="text-[11px] font-semibold text-primary hover:underline"
                onClick={async () => {
                  await save({ notes: notesDraft.trim() || null });
                  setEditingNotes(false);
                }}
              >
                {tCommon("save")}
              </button>
            </div>
          </div>
        ) : patient.notes ? (
          <p className="whitespace-pre-line text-[12px] leading-relaxed text-muted-foreground">
            {patient.notes}
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground">{tPanel("notesEmpty")}</p>
        )}
      </SidebarCard>
    </div>
  );
}

function SidebarCard({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
        {action ? (
          <button
            type="button"
            onClick={onAction}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {action}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 text-[12px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-medium text-foreground",
          mono && "tabular-nums",
        )}
      >
        {value}
      </span>
    </div>
  );
}
