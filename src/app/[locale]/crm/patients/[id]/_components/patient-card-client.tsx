"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { cn } from "@/lib/utils";

import { usePatient } from "../_hooks/use-patient";
import { usePatientAppointments } from "../_hooks/use-patient-appointments";
import { PatientHero } from "./patient-hero";
import { PatientInfoPanel } from "./patient-info-panel";
import { PatientFinanceCard } from "./patient-finance-card";
import { PatientRecommendationsCard } from "./patient-recommendations-card";
import { PatientTimeline } from "./patient-timeline";
import { PatientRightRail } from "./patient-right-rail";
import { SmsDialog } from "./sms-dialog";
import { DeletePatientDialog } from "./delete-patient-dialog";
import { PatientCardSkeleton } from "./patient-card-skeleton";

export function PatientCardClient({ id }: { id: string }) {
  const t = useTranslations("patientCard");
  const locale = useLocale();
  const q = usePatient(id);
  const apptsQ = usePatientAppointments(id);

  const [smsOpen, setSmsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const openNewAppointmentStub = React.useCallback(() => {
    toast.info(t("newAppointmentTodo"));
  }, [t]);

  if (q.isLoading) {
    return <PatientCardSkeleton />;
  }

  if (q.isError) {
    const notFound = q.error.message === "NOT_FOUND";
    return (
      <PageContainer>
        <Link
          href={`/${locale}/crm/patients`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("back")}
        </Link>
        <EmptyState
          title={notFound ? t("notFound.title") : t("error.title")}
          description={notFound ? t("notFound.description") : q.error.message}
          action={
            notFound ? (
              <Link
                href={`/${locale}/crm/patients`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                {t("notFound.back")}
              </Link>
            ) : (
              <Button variant="outline" onClick={() => q.refetch()}>
                <RefreshCwIcon className="size-4" />
                {t("error.retry")}
              </Button>
            )
          }
        />
      </PageContainer>
    );
  }

  const patient = q.data!;
  const appointments = apptsQ.data?.rows ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer>
          <div>
            <Link
              href={`/${locale}/crm/patients`}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
              {t("back")}
            </Link>
          </div>

          <PatientHero
            patient={patient}
            appointments={appointments}
            onOpenSmsDialog={() => setSmsOpen(true)}
            onOpenDeleteDialog={() => setDeleteOpen(true)}
            onOpenNewAppointmentDialog={openNewAppointmentStub}
          />

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
            <PatientInfoPanel patient={patient} appointments={appointments} />

            <div className="flex min-w-0 flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <PatientFinanceCard
                  patient={patient}
                  appointments={appointments}
                />
                <PatientRecommendationsCard
                  patient={patient}
                  appointments={appointments}
                />
              </div>
              <PatientTimeline patientId={patient.id} />
            </div>
          </div>
        </PageContainer>
      </div>

      <aside className="hidden w-[300px] shrink-0 border-l border-border bg-muted/10 xl:flex xl:flex-col">
        <div className="p-4">
          <PatientRightRail
            patient={patient}
            appointments={appointments}
            onOpenNewAppointmentDialog={openNewAppointmentStub}
          />
        </div>
      </aside>

      <SmsDialog
        open={smsOpen}
        onOpenChange={setSmsOpen}
        patientId={patient.id}
        phone={patient.phone}
      />
      <DeletePatientDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        patient={patient}
      />
    </div>
  );
}
