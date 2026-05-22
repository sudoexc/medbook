"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ActivityIcon,
  ArrowLeftIcon,
  ClockIcon,
  PhoneCallIcon,
  PlusIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/molecules/page-container";
import {
  flattenPatients,
  usePatientsList,
  type PatientRow,
  type PatientsListFilters,
} from "../../_hooks/use-patients-list";
import { PatientsTable } from "../../_components/patients-table";
import { NewPatientDialog } from "../../_components/new-patient-dialog";

export type SegmentKey = "new" | "active" | "dormant";

const SEGMENT_META: Record<
  SegmentKey,
  {
    icon: LucideIcon;
    iconBg: string;
    iconFg: string;
    accent: string;
  }
> = {
  new: {
    icon: SparklesIcon,
    iconBg: "bg-warning/15",
    iconFg: "text-warning",
    accent: "border-warning/40",
  },
  active: {
    icon: ActivityIcon,
    iconBg: "bg-success/15",
    iconFg: "text-success",
    accent: "border-success/40",
  },
  dormant: {
    icon: ClockIcon,
    iconBg: "bg-destructive/10",
    iconFg: "text-destructive",
    accent: "border-destructive/40",
  },
};

function filtersFor(segment: SegmentKey): PatientsListFilters {
  switch (segment) {
    case "new": {
      const from = new Date();
      from.setDate(from.getDate() - 7);
      from.setHours(0, 0, 0, 0);
      return {
        registeredFrom: from.toISOString(),
        sort: "createdAt",
        dir: "desc",
      };
    }
    case "active":
      return { segment: "ACTIVE", sort: "lastVisitAt", dir: "desc" };
    case "dormant":
      return { segment: "DORMANT", sort: "lastVisitAt", dir: "desc" };
  }
}

export function PatientSegmentView({ segment }: { segment: SegmentKey }) {
  const t = useTranslations("patientsSegments");
  const locale = useLocale();
  const router = useRouter();
  const meta = SEGMENT_META[segment];
  const Icon = meta.icon;

  const apiFilters = React.useMemo(() => filtersFor(segment), [segment]);
  const query = usePatientsList(apiFilters);
  const rows: PatientRow[] = flattenPatients(query.data);
  const total = query.data?.pages?.[0]?.total ?? null;

  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageContainer fullBleed className="flex-1 pb-0">
        {/* Breadcrumb / back link */}
        <Link
          href={`/${locale}/crm/patients`}
          className="motion-press inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          {t("backToAll")}
        </Link>

        {/* Hero header */}
        <div
          className={cn(
            "motion-rise-in mt-2 flex items-center gap-4 rounded-2xl border bg-card p-4",
            meta.accent,
          )}
        >
          <span
            className={cn(
              "inline-flex size-14 shrink-0 items-center justify-center rounded-2xl",
              meta.iconBg,
              meta.iconFg,
            )}
            aria-hidden
          >
            <Icon className="size-7" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-foreground">
              {t(`${segment}.title`)}
            </h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {t(`${segment}.subtitle`)}
              {total !== null ? (
                <>
                  {" · "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {t("count", { count: total })}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {segment === "dormant" ? (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(`/${locale}/crm/call-center?queue=outbound`)
                }
              >
                <PhoneCallIcon className="size-4" />
                {t("actions.callBack")}
              </Button>
            ) : null}
            <Button onClick={() => setDialogOpen(true)}>
              <PlusIcon className="size-4" />
              {t("actions.new")}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex min-h-[60vh] flex-1 flex-col">
          <PatientsTable
            rows={rows}
            isLoading={query.isLoading}
            isFetchingNextPage={query.isFetchingNextPage}
            hasNextPage={Boolean(query.hasNextPage)}
            onLoadMore={() => query.fetchNextPage()}
            hasFilters={true}
            onCreate={() => setDialogOpen(true)}
            sort={apiFilters.sort}
            dir={apiFilters.dir}
            onSortChange={() => {
              // Sort is locked for segment views — push the user to /crm/patients
              // with the full filter editor if they need to reorder.
              router.push(`/${locale}/crm/patients`);
            }}
            total={total}
            visibleColumns={{
              lastVisitAt: true,
              nextVisitAt: true,
              ltv: true,
              priority: segment === "dormant",
              source: segment === "new",
            }}
          />
        </div>
      </PageContainer>

      <NewPatientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => router.push(`/${locale}/crm/patients/${id}`)}
      />
    </div>
  );
}
