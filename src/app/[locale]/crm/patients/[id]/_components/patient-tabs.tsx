"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { Patient } from "../_hooks/use-patient";
import { canViewMedical, useCurrentRole } from "../_hooks/use-current-role";
import { OverviewTab } from "./tabs/overview-tab";
import { VisitsTab } from "./tabs/visits-tab";
import { DocumentsTab } from "./tabs/documents-tab";
import { CommunicationsTab } from "./tabs/communications-tab";
import { PaymentsTab } from "./tabs/payments-tab";
import { MedicalTab } from "./tabs/medical-tab";

export type PatientTabId =
  | "overview"
  | "visits"
  | "documents"
  | "communications"
  | "payments"
  | "medical";

const TAB_ORDER: PatientTabId[] = [
  "overview",
  "visits",
  "documents",
  "communications",
  "payments",
  "medical",
];

function isTabId(v: string): v is PatientTabId {
  return (TAB_ORDER as string[]).includes(v);
}

export interface PatientTabsProps {
  patient: Patient;
  onOpenNewAppointmentDialog: () => void;
}

export function PatientTabs({
  patient,
  onOpenNewAppointmentDialog,
}: PatientTabsProps) {
  const t = useTranslations("patientCard.tabs");
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = useCurrentRole();

  const initial = searchParams?.get("tab");
  const active: PatientTabId = initial && isTabId(initial) ? initial : "overview";

  const setActive = React.useCallback(
    (next: string) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "overview") {
        sp.delete("tab");
      } else {
        sp.set("tab", next);
      }
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const medicalAllowed = canViewMedical(role);

  return (
    <Tabs
      value={active}
      onValueChange={setActive}
      className="mt-4 flex flex-col gap-4"
    >
      <TabsList
        className={cn(
          "flex-wrap justify-start bg-card border border-border p-1 h-auto",
        )}
      >
        <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
        <TabsTrigger value="visits">{t("visits")}</TabsTrigger>
        <TabsTrigger value="documents">{t("documents")}</TabsTrigger>
        <TabsTrigger value="communications">{t("communications")}</TabsTrigger>
        <TabsTrigger value="payments">{t("payments")}</TabsTrigger>
        {medicalAllowed ? (
          <TabsTrigger value="medical">{t("medical")}</TabsTrigger>
        ) : null}
      </TabsList>

      <TabsContent value="overview">
        <OverviewTab patient={patient} onSwitchTab={setActive} />
      </TabsContent>
      <TabsContent value="visits">
        <VisitsTab
          patient={patient}
          onCreate={onOpenNewAppointmentDialog}
        />
      </TabsContent>
      <TabsContent value="documents">
        <DocumentsTab patient={patient} />
      </TabsContent>
      <TabsContent value="communications">
        <CommunicationsTab patient={patient} />
      </TabsContent>
      <TabsContent value="payments">
        <PaymentsTab patient={patient} />
      </TabsContent>
      {medicalAllowed ? (
        <TabsContent value="medical">
          <MedicalTab patient={patient} role={role} />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
