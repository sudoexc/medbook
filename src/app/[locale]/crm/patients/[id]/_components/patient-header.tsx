"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { formatDate, formatPhone, type Locale } from "@/lib/format";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { SegmentPill } from "@/components/atoms/segment-pill";
import type { PatientSegment } from "@/components/atoms/badge-status";

import {
  type Patient,
  type PatientUpdateInput,
  usePatchPatient,
} from "../_hooks/use-patient";
import { InlineField } from "./inline-field";
import { PatientQuickActions } from "./patient-quick-actions";
import { TagEditor } from "./tag-editor";

function ageFrom(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// The legacy SegmentPill atom uses a different enum ("VIP"|"REGULAR"|"NEW"|"INACTIVE").
// Map the schema enum to the atom's colour scheme.
function segmentAtom(segment: Patient["segment"]): PatientSegment {
  switch (segment) {
    case "VIP":
      return "VIP";
    case "ACTIVE":
      return "REGULAR";
    case "NEW":
      return "NEW";
    case "DORMANT":
    case "CHURN":
      return "INACTIVE";
  }
}

const SOURCE_OPTIONS = [
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
] as const;

export interface PatientHeaderProps {
  patient: Patient;
  onOpenSmsDialog: () => void;
  onOpenDeleteDialog: () => void;
  onOpenNewAppointmentDialog: () => void;
}

export function PatientHeader({
  patient,
  onOpenSmsDialog,
  onOpenDeleteDialog,
  onOpenNewAppointmentDialog,
}: PatientHeaderProps) {
  const t = useTranslations("patientCard.header");
  const tSegment = useTranslations("patients.segment");
  const tSource = useTranslations("patients.source");
  const tGender = useTranslations("patients.gender");
  const locale = useLocale() as Locale;

  const patch = usePatchPatient(patient.id);

  const save = React.useCallback(
    (input: PatientUpdateInput) => patch.mutateAsync(input),
    [patch],
  );

  const age = ageFrom(patient.birthDate);

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        {/* Avatar + name + phone */}
        <div className="flex min-w-0 gap-4">
          <AvatarWithStatus
            src={patient.photoUrl ?? undefined}
            name={patient.fullName}
            size="xl"
            status="online"
          />
          <div className="flex min-w-0 flex-col gap-2">
            <InlineField
              value={patient.fullName}
              display={
                <span className="text-2xl font-semibold text-foreground">
                  {patient.fullName}
                </span>
              }
              onSave={async (next) => {
                if (!next) return;
                await save({ fullName: next });
              }}
              placeholder={t("fullName")}
              allowEmpty={false}
            />

            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <SegmentPill
                segment={segmentAtom(patient.segment)}
                label={tSegment(
                  patient.segment.toLowerCase() as
                    | "new"
                    | "active"
                    | "dormant"
                    | "vip"
                    | "churn",
                )}
              />
              {age !== null ? (
                <span>
                  {age} {t("ageShort")}
                </span>
              ) : null}
              <InlineField
                value={patient.phone}
                display={
                  <span className="tabular-nums">
                    {formatPhone(patient.phone)}
                  </span>
                }
                onSave={async (next) => {
                  if (!next) return;
                  await save({ phone: next });
                }}
                placeholder={t("phone")}
                type="tel"
                allowEmpty={false}
                className="min-w-[160px]"
              />
            </div>

            {/* Inline-edit grid: DOB, gender, source */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <InlineField
                label={t("birthDate")}
                value={
                  patient.birthDate
                    ? patient.birthDate.slice(0, 10)
                    : ""
                }
                display={
                  patient.birthDate
                    ? formatDate(patient.birthDate, locale, "short")
                    : ""
                }
                onSave={async (next) => {
                  await save({
                    birthDate: next
                      ? (new Date(next) as unknown as null)
                      : null,
                  });
                }}
                type="date"
                placeholder="—"
              />
              <InlineField
                label={t("gender")}
                value={patient.gender ?? ""}
                display={
                  patient.gender
                    ? tGender(patient.gender.toLowerCase() as "male" | "female")
                    : ""
                }
                onSave={async (next) => {
                  await save({
                    gender: (next as "MALE" | "FEMALE" | null) || null,
                  });
                }}
                type="select"
                options={[
                  { value: "MALE", label: tGender("male") },
                  { value: "FEMALE", label: tGender("female") },
                ]}
              />
              <InlineField
                label={t("source")}
                value={patient.source ?? ""}
                display={
                  patient.source
                    ? tSource(
                        patient.source.toLowerCase() as
                          | "website"
                          | "telegram"
                          | "instagram"
                          | "call"
                          | "walkin"
                          | "referral"
                          | "ads"
                          | "other",
                      )
                    : ""
                }
                onSave={async (next) => {
                  await save({
                    source:
                      (next as (typeof SOURCE_OPTIONS)[number] | null) || null,
                  });
                }}
                type="select"
                options={SOURCE_OPTIONS.map((s) => ({
                  value: s,
                  label: tSource(
                    s.toLowerCase() as
                      | "website"
                      | "telegram"
                      | "instagram"
                      | "call"
                      | "walkin"
                      | "referral"
                      | "ads"
                      | "other",
                  ),
                }))}
              />
            </div>

            <div className="mt-1">
              <div className="mb-1 text-xs text-muted-foreground">
                {t("tags")}
              </div>
              <TagEditor
                tags={patient.tags}
                onChange={async (next) => {
                  await save({ tags: next });
                }}
              />
            </div>
          </div>
        </div>

        {/* LTV + quick actions */}
        <div className="flex flex-col items-stretch gap-3 lg:w-[320px] lg:items-end">
          <div
            className={cn(
              "flex flex-col items-start gap-1 rounded-lg border border-border bg-muted/30 p-3 lg:items-end lg:text-right",
            )}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("ltv")}
            </div>
            <div className="text-2xl font-semibold text-foreground">
              <MoneyText
                amount={patient.ltv}
                currency="UZS"
                showDual={false}
              />
            </div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span>
                {t("visitsCount")}: {patient.visitsCount}
              </span>
              {patient.balance !== 0 ? (
                <span
                  className={cn(
                    patient.balance < 0
                      ? "text-destructive"
                      : "text-[color:var(--success)]",
                  )}
                >
                  {t("balance")}:{" "}
                  <MoneyText amount={patient.balance} currency="UZS" />
                </span>
              ) : null}
            </div>
          </div>

          <PatientQuickActions
            patient={patient}
            onOpenSmsDialog={onOpenSmsDialog}
            onOpenDeleteDialog={onOpenDeleteDialog}
            onOpenNewAppointmentDialog={onOpenNewAppointmentDialog}
          />
        </div>
      </div>
    </div>
  );
}
