"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { SOURCES, type NewPatientForm, type PatientHit } from "./types";

export function PatientPicker({
  value,
  newPatient,
  newPatientForm,
  onChangePatient,
  onToggleNew,
  onChangeNewPatient,
  disabled,
}: {
  value: PatientHit | null;
  newPatient: boolean;
  newPatientForm: NewPatientForm;
  onChangePatient: (p: PatientHit | null) => void;
  onToggleNew: (on: boolean) => void;
  onChangeNewPatient: (next: NewPatientForm) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("appointments.newDialog.patient");
  const tSource = useTranslations("patients.source");
  const tGender = useTranslations("patients.gender");

  const [search, setSearch] = React.useState("");
  const [searchDebounced, setSearchDebounced] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(search), 250);
    return () => window.clearTimeout(id);
  }, [search]);

  const hits = useQuery<PatientHit[], Error>({
    queryKey: ["patient-autocomplete", searchDebounced],
    enabled: open && searchDebounced.length >= 2,
    queryFn: async ({ signal }) => {
      const qs = new URLSearchParams({ q: searchDebounced, limit: "10" });
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

  return (
    <div className="grid gap-1.5">
      <Label>{t("label")}</Label>

      {value && !newPatient ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{value.fullName}</div>
            <div className="text-xs text-muted-foreground">{value.phone}</div>
          </div>
          {!disabled ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChangePatient(null)}
            >
              <XIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : newPatient ? (
        <NewPatientInline
          values={newPatientForm}
          onChange={onChangeNewPatient}
          onCancel={() => onToggleNew(false)}
          tSource={tSource}
          tGender={tGender}
        />
      ) : (
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
              placeholder={t("searchPlaceholder")}
              className="pl-8"
              disabled={disabled}
            />
          </div>

          {open && searchDebounced.length >= 2 ? (
            <div className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-md">
              {hits.isLoading ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("loading")}
                </div>
              ) : (hits.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("noMatches")}
                </div>
              ) : (
                <ul>
                  {(hits.data ?? []).map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChangePatient(p);
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
              <button
                type="button"
                onClick={() => {
                  onToggleNew(true);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-primary hover:bg-primary/5"
              >
                <PlusIcon className="size-4" />
                {t("createNew")}
              </button>
            </div>
          ) : null}

          {!disabled ? (
            <button
              type="button"
              onClick={() => onToggleNew(true)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <PlusIcon className="size-3.5" />
              {t("createNewShort")}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function NewPatientInline({
  values,
  onChange,
  onCancel,
  tSource,
  tGender,
}: {
  values: NewPatientForm;
  onChange: (next: NewPatientForm) => void;
  onCancel: () => void;
  tSource: ReturnType<typeof useTranslations>;
  tGender: ReturnType<typeof useTranslations>;
}) {
  const t = useTranslations("appointments.newDialog.newPatient");
  return (
    <div className="grid gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          {t("title")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          aria-label={t("cancel")}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label>{t("fullName")}</Label>
          <Input
            value={values.fullName}
            onChange={(e) =>
              onChange({ ...values, fullName: e.target.value })
            }
            placeholder={t("fullNamePlaceholder")}
          />
        </div>
        <div className="grid gap-1">
          <Label>{t("phone")}</Label>
          <Input
            type="tel"
            value={values.phone}
            onChange={(e) => onChange({ ...values, phone: e.target.value })}
            placeholder="+998 90 123 45 67"
          />
        </div>
        <div className="grid gap-1">
          <Label>{t("gender")}</Label>
          <Select
            value={values.gender || ""}
            onValueChange={(v) =>
              onChange({
                ...values,
                gender: (v as "MALE" | "FEMALE") || "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("genderPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MALE">{tGender("male")}</SelectItem>
              <SelectItem value="FEMALE">{tGender("female")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label>{t("source")}</Label>
          <Select
            value={values.source || ""}
            onValueChange={(v) =>
              onChange({
                ...values,
                source: (v as (typeof SOURCES)[number]) || "",
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("sourcePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {tSource(s.toLowerCase() as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
