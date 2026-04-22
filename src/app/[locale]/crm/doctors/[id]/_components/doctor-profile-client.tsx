"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/molecules/page-container";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import { useDoctor } from "../_hooks/use-doctor";
import { DoctorHeader } from "./doctor-header";
import { DoctorHeatGrid } from "./doctor-heat-grid";
import { DoctorFinances } from "./doctor-finances";
import { ScheduleEditor } from "./schedule-editor";
import { DoctorTimeOff } from "./doctor-time-off";
import { DoctorPatientsList } from "./doctor-patients-list";
import { DoctorReviews } from "./doctor-reviews";
import { useCurrentRole } from "@/app/[locale]/crm/patients/[id]/_hooks/use-current-role";

type TabId = "overview" | "schedule" | "patients" | "reviews";

const TAB_ORDER: TabId[] = ["overview", "schedule", "patients", "reviews"];

function isTabId(v: string): v is TabId {
  return (TAB_ORDER as string[]).includes(v);
}

/**
 * Fetches the most recent FX rate so child components can render dual
 * UZS+USD money. Returns `null` if no rate is available; UI falls back to
 * single-currency display.
 *
 * Rate model stores `rateUsd` as tiin-per-cent (see `MoneyText`/LTV service
 * convention), which is what `DoctorFinances.computeUsd` expects.
 */
function useLatestUsdRate(): number | null {
  const q = useQuery<number | null, Error>({
    queryKey: ["exchange-rate", "latest"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/exchange-rates?limit=1`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const j = (await res.json()) as {
        rows?: { rateUsd: number | string }[];
      };
      const first = j.rows?.[0];
      if (!first) return null;
      const n = Number(first.rateUsd);
      return Number.isFinite(n) && n > 0 ? n : null;
    },
    staleTime: 10 * 60_000,
  });
  return q.data ?? null;
}

export interface DoctorProfileClientProps {
  id: string;
}

export function DoctorProfileClient({ id }: DoctorProfileClientProps) {
  const t = useTranslations("crmDoctors");
  const tTabs = useTranslations("crmDoctors.tabs");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = useCurrentRole();

  const q = useDoctor(id);
  const usdRate = useLatestUsdRate();

  const [apptOpen, setApptOpen] = React.useState(false);

  // Receptionists + call operators don't see patient rosters; doctors see
  // their own only (API enforces this — but we hide the tab anyway).
  const canSeePatients =
    role !== "RECEPTIONIST" && role !== "CALL_OPERATOR";

  const initial = searchParams?.get("tab");
  const active: TabId = initial && isTabId(initial) ? initial : "overview";

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

  if (q.isLoading) {
    return (
      <PageContainer>
        <Link
          href={`/${locale}/crm/doctors`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("back")}
        </Link>
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </PageContainer>
    );
  }

  if (q.isError) {
    const notFound = q.error.message === "NOT_FOUND";
    return (
      <PageContainer>
        <Link
          href={`/${locale}/crm/doctors`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("back")}
        </Link>
        <EmptyState
          title={
            notFound ? t("profile.notFoundTitle") : t("profile.errorTitle")
          }
          description={
            notFound ? t("profile.notFoundDescription") : q.error.message
          }
          action={
            notFound ? (
              <Link
                href={`/${locale}/crm/doctors`}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                {t("back")}
              </Link>
            ) : (
              <Button variant="outline" onClick={() => q.refetch()}>
                <RefreshCwIcon className="size-4" />
                {t("profile.retry")}
              </Button>
            )
          }
        />
      </PageContainer>
    );
  }

  const doctor = q.data!;

  return (
    <PageContainer>
      <div>
        <Link
          href={`/${locale}/crm/doctors`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("back")}
        </Link>
      </div>

      <DoctorHeader
        doctor={doctor}
        onNewAppointment={() => setApptOpen(true)}
      />

      <Tabs value={active} onValueChange={setActive} className="gap-4">
        <TabsList>
          <TabsTrigger value="overview">{tTabs("overview")}</TabsTrigger>
          <TabsTrigger value="schedule">{tTabs("schedule")}</TabsTrigger>
          {canSeePatients ? (
            <TabsTrigger value="patients">{tTabs("patients")}</TabsTrigger>
          ) : null}
          <TabsTrigger value="reviews">{tTabs("reviews")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <DoctorHeatGrid doctorId={doctor.id} />
          <DoctorFinances doctorId={doctor.id} usdRate={usdRate} />
        </TabsContent>

        <TabsContent value="schedule" className="flex flex-col gap-4">
          <ScheduleEditor doctor={doctor} />
          <DoctorTimeOff doctor={doctor} />
        </TabsContent>

        {canSeePatients ? (
          <TabsContent value="patients" className="flex flex-col gap-4">
            <DoctorPatientsList doctorId={doctor.id} />
          </TabsContent>
        ) : null}

        <TabsContent value="reviews" className="flex flex-col gap-4">
          <DoctorReviews doctorId={doctor.id} />
        </TabsContent>
      </Tabs>

      <NewAppointmentDialog
        open={apptOpen}
        onOpenChange={setApptOpen}
        initialDoctorId={doctor.id}
      />
    </PageContainer>
  );
}
