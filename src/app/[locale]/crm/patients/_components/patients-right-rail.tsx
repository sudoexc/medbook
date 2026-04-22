"use client";

import * as React from "react";

import { usePatientsStats } from "../_hooks/use-patients-stats";
import { DemographicsWidget } from "./demographics-widget";
import { SourcesWidget } from "./sources-widget";
import { BirthdaysWidget } from "./birthdays-widget";
import { TopServicesWidget } from "./top-services-widget";

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
