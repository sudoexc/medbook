"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { usePatient } from "../_hooks/use-patient";
import { PatientHeader } from "./patient-header";
import { PatientTabs } from "./patient-tabs";
import { SmsDialog } from "./sms-dialog";
import { DeletePatientDialog } from "./delete-patient-dialog";
import { PatientCardSkeleton } from "./patient-card-skeleton";

/**
 * Top-level client component for `/crm/patients/[id]`. Orchestrates data
 * fetching, dialog state, and the header / tabs layout.
 *
 * The skeleton + EmptyState fallbacks cover loading, "not found", and
 * network errors — the page never blows up mid-render.
 */
export function PatientCardClient({ id }: { id: string }) {
  const t = useTranslations("patientCard");
  const locale = useLocale();
  const q = usePatient(id);

  const [smsOpen, setSmsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const openNewAppointmentStub = React.useCallback(() => {
    // Phase 2b will replace this stub with the real NewAppointmentDialog.
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

  return (
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

      <PatientHeader
        patient={patient}
        onOpenSmsDialog={() => setSmsOpen(true)}
        onOpenDeleteDialog={() => setDeleteOpen(true)}
        onOpenNewAppointmentDialog={openNewAppointmentStub}
      />

      <PatientTabs
        patient={patient}
        onOpenNewAppointmentDialog={openNewAppointmentStub}
      />

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
    </PageContainer>
  );
}
