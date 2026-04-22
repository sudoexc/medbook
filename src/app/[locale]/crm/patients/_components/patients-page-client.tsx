"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";

import { usePatientsFilters } from "../_hooks/use-patients-filters";
import {
  flattenPatients,
  usePatientsList,
  type PatientRow,
} from "../_hooks/use-patients-list";
import { PatientsFilters } from "./patients-filters";
import { PatientsTable } from "./patients-table";
import { PatientsRightRail } from "./patients-right-rail";
import { NewPatientDialog } from "./new-patient-dialog";
import { ExportButton } from "./export-button";

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

export function PatientsPageClient() {
  const t = useTranslations("patients");
  const router = useRouter();
  const { state, apiFilters, setFilter, clearAll } = usePatientsFilters();

  const [dialogOpen, setDialogOpen] = React.useState(false);

  const query = usePatientsList(apiFilters);

  const allRows = flattenPatients(query.data);

  // Client-side age filter (server has no such column yet — pragmatic Phase 2a).
  const rows: PatientRow[] = React.useMemo(() => {
    if (state.ageMin === undefined && state.ageMax === undefined) return allRows;
    return allRows.filter((p) => {
      const age = ageFrom(p.birthDate);
      if (age === null) return false;
      if (state.ageMin !== undefined && age < state.ageMin) return false;
      if (state.ageMax !== undefined && age > state.ageMax) return false;
      return true;
    });
  }, [allRows, state.ageMin, state.ageMax]);

  const total = query.data?.pages?.[0]?.total ?? null;

  const hasFilters =
    Boolean(state.q) ||
    Boolean(state.segment) ||
    Boolean(state.gender) ||
    Boolean(state.source) ||
    Boolean(state.tag) ||
    Boolean(state.ageMin) ||
    Boolean(state.ageMax) ||
    state.balance === "debt";

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <SectionHeader
            title={t("title")}
            subtitle={t("subtitle")}
            meta={
              total !== null ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t("count", { count: total })}
                </span>
              ) : null
            }
            actions={
              <>
                <ExportButton />
                <Button onClick={() => setDialogOpen(true)}>
                  <PlusIcon className="size-4" />
                  {t("new")}
                </Button>
              </>
            }
          />

          <PatientsFilters
            state={state}
            onChange={setFilter}
            onClear={clearAll}
          />

          <div className="flex min-h-[60vh] flex-1 flex-col">
            <PatientsTable
              rows={rows}
              isLoading={query.isLoading}
              isFetchingNextPage={query.isFetchingNextPage}
              hasNextPage={Boolean(query.hasNextPage)}
              onLoadMore={() => query.fetchNextPage()}
              hasFilters={hasFilters}
              onCreate={() => setDialogOpen(true)}
              sort={state.sort}
              dir={state.dir}
              onSortChange={(sort, dir) => {
                setFilter("sort", sort);
                setFilter("dir", dir);
              }}
              total={total}
            />
          </div>
        </PageContainer>
      </div>

      <aside
        className="hidden w-[340px] shrink-0 flex-col border-l border-border bg-card p-3 xl:flex"
        aria-label={t("widgets.demographics")}
      >
        <PatientsRightRail />
      </aside>

      <NewPatientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => router.push(`/crm/patients/${id}`)}
      />
    </div>
  );
}
