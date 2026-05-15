"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type PickedPatient = {
  id: string;
  fullName: string;
  phone: string | null;
};

type PatientHit = {
  id: string;
  fullName: string;
  phone: string;
};

/**
 * Slim version of the appointments PatientPicker — search-only, no
 * new-patient flow. Returns the picked id to the parent.
 */
export function ReminderPatientPicker({
  value,
  onChange,
  disabled,
}: {
  value: PickedPatient | null;
  onChange: (next: PickedPatient | null) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const hits = useQuery<PatientHit[], Error>({
    queryKey: ["patient-autocomplete", debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ q: debounced, limit: "10" });
      const res = await fetch(`/api/crm/patients?${qs.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: PatientHit[] };
      return j.rows;
    },
    staleTime: 30_000,
  });

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{value.fullName}</div>
          {value.phone ? (
            <div className="text-xs text-muted-foreground">{value.phone}</div>
          ) : null}
        </div>
        {!disabled ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onChange(null)}
          >
            <XIcon className="size-4" />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Поиск пациента…"
          className="pl-8"
          disabled={disabled}
        />
      </div>

      {open && debounced.length >= 2 ? (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
          {hits.isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Поиск…
            </div>
          ) : (hits.data ?? []).length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            <ul>
              {(hits.data ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange({
                        id: p.id,
                        fullName: p.fullName,
                        phone: p.phone,
                      });
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {p.fullName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.phone}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
