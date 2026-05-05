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
import { useCurrentRole, canViewMedical } from "../_hooks/use-current-role";
import { PatientHero } from "./patient-hero";
import { PatientInfoPanel } from "./patient-info-panel";
import { PatientFinanceCard } from "./patient-finance-card";
import { PatientRecommendationsCard } from "./patient-recommendations-card";
import { PatientTimeline } from "./patient-timeline";
import { PatientRightRail } from "./patient-right-rail";
import { SmsDialog } from "./sms-dialog";
import { DeletePatientDialog } from "./delete-patient-dialog";
import { PatientCardSkeleton } from "./patient-card-skeleton";

// Tabs are lazy-loaded so the initial overview render stays light. Only the
// active tab + its dependencies are bundled in the initial chunk.
const VisitsTab = React.lazy(() =>
  import("./tabs/visits-tab").then((m) => ({ default: m.VisitsTab })),
);
const CasesTab = React.lazy(() =>
  import("./tabs/cases-tab").then((m) => ({ default: m.CasesTab })),
);
const MedicalTab = React.lazy(() =>
  import("./tabs/medical-tab").then((m) => ({ default: m.MedicalTab })),
);
const DocumentsTab = React.lazy(() =>
  import("./tabs/documents-tab").then((m) => ({ default: m.DocumentsTab })),
);
const PaymentsTab = React.lazy(() =>
  import("./tabs/payments-tab").then((m) => ({ default: m.PaymentsTab })),
);
const CommunicationsTab = React.lazy(() =>
  import("./tabs/communications-tab").then((m) => ({
    default: m.CommunicationsTab,
  })),
);

type TabKey =
  | "overview"
  | "visits"
  | "cases"
  | "medical"
  | "documents"
  | "payments"
  | "communications";

const TAB_ORDER: { key: TabKey; tKey: string }[] = [
  { key: "overview", tKey: "overview" },
  { key: "visits", tKey: "visits" },
  { key: "cases", tKey: "cases" },
  { key: "medical", tKey: "medical" },
  { key: "documents", tKey: "documents" },
  { key: "payments", tKey: "payments" },
  { key: "communications", tKey: "communications" },
];

export function PatientCardClient({ id }: { id: string }) {
  const t = useTranslations("patientCard");
  const tTabs = useTranslations("patientCard.tabs");
  const locale = useLocale();
  const role = useCurrentRole();
  const q = usePatient(id);
  const apptsQ = usePatientAppointments(id);

  const [smsOpen, setSmsOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [tab, setTab] = React.useState<TabKey>("overview");

  // Hash deep-link: when arriving with `#case-<id>`, switch to the Cases tab
  // so the Cases-tab effect can scroll the matching card into view. Listens
  // for hashchange so navigations within the page (drawer pill back to
  // patient card with a different case anchor) also re-trigger the switch.
  React.useEffect(() => {
    const apply = () => {
      const h =
        typeof window !== "undefined" ? window.location.hash : "";
      if (h.startsWith("#case-")) setTab("cases");
    };
    apply();
    if (typeof window !== "undefined") {
      window.addEventListener("hashchange", apply);
      return () => window.removeEventListener("hashchange", apply);
    }
  }, []);

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
  const showMedical = canViewMedical(role);
  const visibleTabs = TAB_ORDER.filter(
    (tb) => tb.key !== "medical" || showMedical,
  );

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

          <div
            role="tablist"
            aria-label={t("tabs.overview")}
            className="flex flex-wrap gap-1 border-b border-border"
          >
            {visibleTabs.map((tb) => {
              const active = tab === tb.key;
              return (
                <button
                  key={tb.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(tb.key)}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tTabs(tb.tKey as never)}
                </button>
              );
            })}
          </div>

          {tab === "overview" ? (
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
          ) : (
            <React.Suspense
              fallback={
                <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                  …
                </div>
              }
            >
              {tab === "visits" ? (
                <VisitsTab
                  patient={patient}
                  onCreate={openNewAppointmentStub}
                />
              ) : tab === "cases" ? (
                <CasesTab patient={patient} />
              ) : tab === "medical" && showMedical ? (
                <MedicalTab patient={patient} role={role} />
              ) : tab === "documents" ? (
                <DocumentsTab patient={patient} />
              ) : tab === "payments" ? (
                <PaymentsTab patient={patient} />
              ) : tab === "communications" ? (
                <CommunicationsTab patient={patient} />
              ) : null}
            </React.Suspense>
          )}
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
