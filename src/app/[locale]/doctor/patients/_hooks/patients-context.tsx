"use client";

import * as React from "react";

import type { DoctorPatientTab, DoctorPatientsFilters } from "./use-my-patients";

type PatientsContextValue = {
  filters: DoctorPatientsFilters;
  setQ: (q: string) => void;
  setTab: (tab: DoctorPatientTab) => void;
  // The currently previewed row on the listing — drives `SelectedPatientCard`.
  // Distinct from "navigate to detail page" (that's handled by the row's
  // primary click → `/doctor/patients/[id]`). Selection is just preview.
  selectedPatientId: string | null;
  setSelectedPatientId: (id: string | null) => void;
};

const PatientsContext = React.createContext<PatientsContextValue | null>(null);

export function PatientsFiltersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [q, setQ] = React.useState<string>("");
  const [tab, setTab] = React.useState<DoctorPatientTab>("all");
  const [selectedPatientId, setSelectedPatientId] = React.useState<
    string | null
  >(null);

  // Debounce the search input — typing should feel fluid but we don't want
  // a request per keystroke. 250 ms matches the CRM-side patient search.
  const [debouncedQ, setDebouncedQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const value = React.useMemo<PatientsContextValue>(
    () => ({
      filters: {
        q: debouncedQ.trim() ? debouncedQ.trim() : undefined,
        tab,
      },
      setQ,
      setTab,
      selectedPatientId,
      setSelectedPatientId,
    }),
    [debouncedQ, tab, selectedPatientId],
  );

  return (
    <PatientsContext.Provider value={value}>
      {children}
    </PatientsContext.Provider>
  );
}

export function usePatientsFilters(): PatientsContextValue {
  const ctx = React.useContext(PatientsContext);
  if (!ctx) {
    throw new Error(
      "usePatientsFilters must be used inside <PatientsFiltersProvider>",
    );
  }
  return ctx;
}
