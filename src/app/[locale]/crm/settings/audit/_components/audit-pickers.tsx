"use client";

/**
 * Pick a patient by name or phone, and a staff member from the clinic's
 * list, for the audit log filters (audit G1-10). The filters used to take
 * raw ids only («patientId», «userId»): an admin investigating a patient
 * had no id to type.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { settingsFetch } from "../../_hooks/use-settings-api";

type PatientHit = { id: string; fullName: string; phone: string | null };

export function AuditPatientPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  /** The selected patient id ("" for none). */
  value: string;
  onChange: (patientId: string) => void;
}) {
  const t = useTranslations("settings.audit.filters");
  const [term, setTerm] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  // The name of a patient picked here; a patient that arrived with the URL
  // (the card's «Журнал по пациенту») shows the id tail instead.
  const [picked, setPicked] = React.useState<PatientHit | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const hits = useQuery<{ rows: PatientHit[] }>({
    queryKey: ["settings", "audit", "patient-picker", debounced],
    enabled: debounced.length >= 2,
    queryFn: () =>
      settingsFetch(
        `/api/crm/patients?limit=8&q=${encodeURIComponent(debounced)}`,
      ),
  });

  if (value) {
    const label =
      picked && picked.id === value ? picked.fullName : `#${value.slice(-6)}`;
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm">
        <span className="truncate">{label}</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label={t("patientClear")}
          onClick={() => {
            setPicked(null);
            onChange("");
          }}
        >
          <XIcon className="size-4" />
        </button>
      </div>
    );
  }

  const rows = hits.data?.rows ?? [];
  return (
    <div className="relative">
      <Input
        id={id}
        value={term}
        placeholder={t("patientPlaceholder")}
        autoComplete="off"
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && debounced.length >= 2 ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
          {rows.length === 0 && !hits.isFetching ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t("patientNone")}
            </div>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPicked(p);
                  setTerm("");
                  setOpen(false);
                  onChange(p.id);
                }}
              >
                <span className="truncate">{p.fullName}</span>
                {p.phone ? (
                  <span className="text-xs text-muted-foreground">{p.phone}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

type StaffRow = { id: string; name: string | null; email: string; role: string };

export function AuditStaffSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (userId: string) => void;
}) {
  const t = useTranslations("settings.audit.filters");
  const staff = useQuery<{ rows: StaffRow[] }>({
    queryKey: ["settings", "audit", "staff"],
    queryFn: () => settingsFetch("/api/crm/users?limit=500"),
    staleTime: 5 * 60_000,
  });
  const rows = staff.data?.rows ?? [];
  const known = rows.some((r) => r.id === value);
  return (
    <Select
      value={value || "__all"}
      onValueChange={(v) => onChange(v === "__all" ? "" : v)}
    >
      <SelectTrigger className="h-9 w-full">
        <SelectValue placeholder={t("staffAll")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">{t("staffAll")}</SelectItem>
        {value && !known ? (
          <SelectItem value={value}>{`#${value.slice(-6)}`}</SelectItem>
        ) : null}
        {rows.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {(r.name || r.email) + ` (${r.role})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
