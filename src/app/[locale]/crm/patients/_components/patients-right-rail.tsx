"use client";

import * as React from "react";
import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

import { usePatientsStats } from "../_hooks/use-patients-stats";
import { BirthdaysWidget } from "./birthdays-widget";
import { TopServicesWidget } from "./top-services-widget";

// Recharts is only used by these two widgets inside the patients list.
// Loading them dynamically keeps recharts out of the patients-list JS
// bundle (shaves ~90KB gzip off initial load).
const chartSkeleton = (
  <div className="rounded-lg border border-border bg-card p-3">
    <Skeleton className="h-48 w-full" />
  </div>
);

const DemographicsWidget = dynamic(
  () => import("./demographics-widget").then((m) => m.DemographicsWidget),
  { ssr: false, loading: () => chartSkeleton },
);

const SourcesWidget = dynamic(
  () => import("./sources-widget").then((m) => m.SourcesWidget),
  { ssr: false, loading: () => chartSkeleton },
);

export function PatientsRightRail() {
  const { data, isLoading } = usePatientsStats();
  return (
    <div className="flex flex-col gap-3">
      <DemographicsWidget stats={data} isLoading={isLoading} />
      <SourcesWidget stats={data} isLoading={isLoading} />
      <BirthdaysWidget stats={data} isLoading={isLoading} />
      <TopServicesWidget stats={data} isLoading={isLoading} />
    </div>
  );
}
