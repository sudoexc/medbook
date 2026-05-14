"use client";

import * as React from "react";

import type {
  DocumentType,
  DoctorDocumentsFilters,
} from "./use-doctor-documents";

export type DocumentTab = "all" | DocumentType;

type DocumentsContextValue = {
  filters: DoctorDocumentsFilters;
  tab: DocumentTab;
  setQ: (q: string) => void;
  setTab: (tab: DocumentTab) => void;
};

const DocumentsContext = React.createContext<DocumentsContextValue | null>(
  null,
);

export function DocumentsFiltersProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [q, setQ] = React.useState<string>("");
  const [tab, setTab] = React.useState<DocumentTab>("all");

  const [debouncedQ, setDebouncedQ] = React.useState(q);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const value = React.useMemo<DocumentsContextValue>(
    () => ({
      filters: {
        q: debouncedQ.trim() ? debouncedQ.trim() : undefined,
        type: tab === "all" ? undefined : tab,
      },
      tab,
      setQ,
      setTab,
    }),
    [debouncedQ, tab],
  );

  return (
    <DocumentsContext.Provider value={value}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocumentsFilters(): DocumentsContextValue {
  const ctx = React.useContext(DocumentsContext);
  if (!ctx) {
    throw new Error(
      "useDocumentsFilters must be used inside <DocumentsFiltersProvider>",
    );
  }
  return ctx;
}
