"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { BadgeCheckIcon, InfoIcon } from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";

type Role =
  | "ADMIN"
  | "RECEPTIONIST"
  | "CALL_OPERATOR"
  | "DOCTOR"
  | "NURSE";

type Cell = "RWUD" | "RWU" | "RW" | "R" | "Rown" | "Rltd" | "Rtoday" | "W" | "U" | "own" | "D" | "—";

const ROW_KEYS = [
  "reception",
  "appointmentsList",
  "appointmentsCreate",
  "appointmentsStatus",
  "appointmentsDelete",
  "calendar",
  "patientsList",
  "patientsCard",
  "patientsDelete",
  "doctorsAnalytics",
  "doctorsEdit",
  "callCenter",
  "telegram",
  "sms",
  "notificationsTemplates",
  "notificationsSend",
  "payments",
  "documents",
  "settings",
  "users",
  "audit",
  "export",
] as const;

const MATRIX: Record<
  (typeof ROW_KEYS)[number],
  Record<Role, Cell>
> = {
  reception: {
    ADMIN: "RWUD",
    RECEPTIONIST: "RWU",
    CALL_OPERATOR: "Rltd",
    DOCTOR: "own",
    NURSE: "R",
  },
  appointmentsList: {
    ADMIN: "R",
    RECEPTIONIST: "R",
    CALL_OPERATOR: "R",
    DOCTOR: "Rown",
    NURSE: "Rtoday",
  },
  appointmentsCreate: {
    ADMIN: "W",
    RECEPTIONIST: "W",
    CALL_OPERATOR: "W",
    DOCTOR: "—",
    NURSE: "—",
  },
  appointmentsStatus: {
    ADMIN: "U",
    RECEPTIONIST: "U",
    CALL_OPERATOR: "U",
    DOCTOR: "own",
    NURSE: "U",
  },
  appointmentsDelete: {
    ADMIN: "D",
    RECEPTIONIST: "D",
    CALL_OPERATOR: "—",
    DOCTOR: "—",
    NURSE: "—",
  },
  calendar: {
    ADMIN: "RWUD",
    RECEPTIONIST: "RWU",
    CALL_OPERATOR: "RWU",
    DOCTOR: "Rown",
    NURSE: "R",
  },
  patientsList: {
    ADMIN: "R",
    RECEPTIONIST: "R",
    CALL_OPERATOR: "R",
    DOCTOR: "R",
    NURSE: "R",
  },
  patientsCard: {
    ADMIN: "RWUD",
    RECEPTIONIST: "RWU",
    CALL_OPERATOR: "Rltd",
    DOCTOR: "RW",
    NURSE: "R",
  },
  patientsDelete: {
    ADMIN: "D",
    RECEPTIONIST: "—",
    CALL_OPERATOR: "—",
    DOCTOR: "—",
    NURSE: "—",
  },
  doctorsAnalytics: {
    ADMIN: "R",
    RECEPTIONIST: "Rltd",
    CALL_OPERATOR: "—",
    DOCTOR: "Rown",
    NURSE: "—",
  },
  doctorsEdit: {
    ADMIN: "U",
    RECEPTIONIST: "—",
    CALL_OPERATOR: "—",
    DOCTOR: "own",
    NURSE: "—",
  },
  callCenter: {
    ADMIN: "R",
    RECEPTIONIST: "R",
    CALL_OPERATOR: "RWUD",
    DOCTOR: "—",
    NURSE: "—",
  },
  telegram: {
    ADMIN: "R",
    RECEPTIONIST: "RWU",
    CALL_OPERATOR: "RWU",
    DOCTOR: "—",
    NURSE: "—",
  },
  sms: {
    ADMIN: "R",
    RECEPTIONIST: "RW",
    CALL_OPERATOR: "RW",
    DOCTOR: "—",
    NURSE: "—",
  },
  notificationsTemplates: {
    ADMIN: "RWUD",
    RECEPTIONIST: "R",
    CALL_OPERATOR: "R",
    DOCTOR: "R",
    NURSE: "—",
  },
  notificationsSend: {
    ADMIN: "W",
    RECEPTIONIST: "W",
    CALL_OPERATOR: "W",
    DOCTOR: "—",
    NURSE: "—",
  },
  payments: {
    ADMIN: "RWUD",
    RECEPTIONIST: "RWU",
    CALL_OPERATOR: "Rltd",
    DOCTOR: "Rown",
    NURSE: "—",
  },
  documents: {
    ADMIN: "RWUD",
    RECEPTIONIST: "RWU",
    CALL_OPERATOR: "R",
    DOCTOR: "RW",
    NURSE: "R",
  },
  settings: {
    ADMIN: "RWUD",
    RECEPTIONIST: "—",
    CALL_OPERATOR: "—",
    DOCTOR: "—",
    NURSE: "—",
  },
  users: {
    ADMIN: "RWUD",
    RECEPTIONIST: "—",
    CALL_OPERATOR: "—",
    DOCTOR: "—",
    NURSE: "—",
  },
  audit: {
    ADMIN: "R",
    RECEPTIONIST: "—",
    CALL_OPERATOR: "—",
    DOCTOR: "—",
    NURSE: "—",
  },
  export: {
    ADMIN: "R",
    RECEPTIONIST: "R",
    CALL_OPERATOR: "—",
    DOCTOR: "—",
    NURSE: "—",
  },
};

function CellBadge({ value }: { value: Cell }) {
  if (value === "—") {
    return <span className="text-muted-foreground">—</span>;
  }
  const colour =
    value.includes("D") || value.includes("UD")
      ? "bg-emerald-500/15 text-emerald-700"
      : value.startsWith("R")
        ? "bg-primary/15 text-primary"
        : "bg-amber-500/15 text-amber-700";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${colour}`}
    >
      {value}
    </span>
  );
}

export function RolesMatrixClient() {
  const t = useTranslations("settings");
  const ROLES: Role[] = [
    "ADMIN",
    "RECEPTIONIST",
    "CALL_OPERATOR",
    "DOCTOR",
    "NURSE",
  ];

  return (
    <PageContainer>
      <SectionHeader
        title={t("roles.title")}
        subtitle={t("roles.subtitle")}
        actions={
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            <BadgeCheckIcon className="size-4 text-primary" />
            {t("roles.readOnlyForAdmin")}
          </div>
        }
      />

      <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">{t("roles.legendTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("roles.legendBody")}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="sticky left-0 bg-muted/50 px-3 py-2 font-medium">
                {t("roles.sectionCol")}
              </th>
              {ROLES.map((r) => (
                <th key={r} className="px-3 py-2 font-medium">
                  {t(`users.roles.${r}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROW_KEYS.map((k) => (
              <tr key={k} className="border-t border-border">
                <td className="sticky left-0 bg-card px-3 py-2 font-medium">
                  {t(`roles.rows.${k}`)}
                </td>
                {ROLES.map((r) => (
                  <td key={r} className="px-3 py-2">
                    <CellBadge value={MATRIX[k][r]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageContainer>
  );
}
