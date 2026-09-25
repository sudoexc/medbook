"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parsePatientIdentity } from "@/lib/patients/parse-identity";
import { tashkentToday } from "@/lib/tashkent-time";

import { type Patient, patientKey } from "../_hooks/use-patient";
import {
  draftFromPatient,
  editPatientPatch,
  type EditPatientDraft,
  type EditPatientError,
} from "./edit-patient-form";

const SOURCES = [
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
] as const;

/** Radix Select has no empty value; this stands for «not set». */
const NONE = "__none";

type PhoneOwner = { id: string; fullName: string };

/** The number belongs to another card; carries whose, for the link. */
class PhoneTakenError extends Error {
  constructor(readonly owner: PhoneOwner | null) {
    super("PHONE_TAKEN");
  }
}

export interface EditPatientDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  patient: Patient;
}

/**
 * «Редактировать» on the patient card (audit PT-01): the one place the
 * front desk corrects who the patient is. A Mini App sign-up arrives as
 * «Jasur 🙂» with no birth date, and until this dialog nothing in the CRM
 * could fix it, so conclusions printed no age and search missed the card.
 * Only changed fields are sent (see `editPatientPatch`).
 */
export function EditPatientDialog({
  open,
  onOpenChange,
  patient,
}: EditPatientDialogProps) {
  const t = useTranslations("patientCard.editDialog");
  const tNew = useTranslations("patients.newDialog");
  const tGender = useTranslations("patients.gender");
  const tSource = useTranslations("patients.source");
  const locale = useLocale();
  const qc = useQueryClient();

  const [draft, setDraft] = React.useState<EditPatientDraft>(() =>
    draftFromPatient(patient),
  );
  const [error, setError] = React.useState<EditPatientError | null>(null);
  const [phoneOwner, setPhoneOwner] = React.useState<
    PhoneOwner | "unknown" | null
  >(null);

  // Every opening starts from the card as it is now, not a stale draft.
  React.useEffect(() => {
    if (open) {
      setDraft(draftFromPatient(patient));
      setError(null);
      setPhoneOwner(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = <K extends keyof EditPatientDraft>(
    key: K,
    value: EditPatientDraft[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (key === "fullName" && error === "name") setError(null);
    if (key === "phone") {
      if (error === "phone") setError(null);
      setPhoneOwner(null);
    }
  };

  const mutation = useMutation<Patient, Error, Record<string, unknown>>({
    mutationFn: async (patch) => {
      const res = await fetch(`/api/crm/patients/${patient.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          reason?: string;
          owner?: PhoneOwner;
        } | null;
        if (res.status === 409 && j?.reason === "phone_taken") {
          throw new PhoneTakenError(j.owner ?? null);
        }
        if (res.status === 409 && j?.reason === "phone_or_telegram_taken") {
          throw new PhoneTakenError(null);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as Patient;
    },
    onSuccess: (fresh) => {
      qc.setQueryData<Patient>(patientKey(patient.id), (prev) =>
        prev ? { ...prev, ...fresh } : fresh,
      );
      qc.invalidateQueries({ queryKey: patientKey(patient.id) });
      qc.invalidateQueries({ queryKey: ["patients"] });
      toast.success(t("saved"));
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof PhoneTakenError) {
        setPhoneOwner(e.owner ?? "unknown");
        return;
      }
      toast.error(t("saveFailed"));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = editPatientPatch(patient, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (Object.keys(result.patch).length === 0) {
      onOpenChange(false);
      return;
    }
    mutation.mutate(result.patch as Record<string, unknown>);
  };

  // «Турматов Отабек 1969»: the server moves the year into the birth date,
  // unless a date is typed below in the same save. Say so before saving.
  const parsedName = parsePatientIdentity(draft.fullName);
  const nameYearHint =
    parsedName.matched && parsedName.birthYear !== null
      ? draft.birthDate && draft.birthDate !== draftFromPatient(patient).birthDate
        ? tNew("yearInNameIgnored", { year: parsedName.birthYear })
        : tNew("yearInNameParsed", {
            name: parsedName.fullName,
            year: parsedName.birthYear,
          })
      : null;

  const today = tashkentToday();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="ep-name">{t("fullName")}</Label>
            <Input
              id="ep-name"
              value={draft.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              aria-invalid={error === "name"}
              autoFocus
            />
            {error === "name" ? (
              <p className="motion-error-in text-xs text-destructive">
                {t("errorName")}
              </p>
            ) : nameYearHint ? (
              <p className="rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-[11px] leading-snug text-foreground">
                {nameYearHint}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {t("fullNameHint")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="ep-phone">{t("phone")}</Label>
              <Input
                id="ep-phone"
                type="tel"
                placeholder="+998 90 123 45 67"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
                aria-invalid={error === "phone" || phoneOwner !== null}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ep-dob">{t("birthDate")}</Label>
              <Input
                id="ep-dob"
                type="date"
                max={today}
                value={draft.birthDate}
                onChange={(e) => set("birthDate", e.target.value)}
              />
            </div>
          </div>
          {error === "phone" ? (
            <p className="motion-error-in -mt-1 text-xs text-destructive">
              {t("errorPhone")}
            </p>
          ) : null}
          {phoneOwner !== null ? (
            <div className="motion-error-in -mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-foreground">
              <span>
                {phoneOwner === "unknown"
                  ? t("phoneTakenUnknown")
                  : t("phoneTaken", { name: phoneOwner.fullName })}
              </span>
              {phoneOwner !== "unknown" ? (
                <Link
                  href={`/${locale}/crm/patients/${phoneOwner.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {t("openOwner")}
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="grid gap-1">
              <Label htmlFor="ep-gender">{t("gender")}</Label>
              <Select
                value={draft.gender || NONE}
                onValueChange={(v) =>
                  set("gender", v === NONE ? "" : (v as "MALE" | "FEMALE"))
                }
              >
                <SelectTrigger id="ep-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                  <SelectItem value="MALE">{tGender("male")}</SelectItem>
                  <SelectItem value="FEMALE">{tGender("female")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ep-source">{t("source")}</Label>
              <Select
                value={draft.source || NONE}
                onValueChange={(v) =>
                  set(
                    "source",
                    v === NONE ? "" : (v as (typeof SOURCES)[number]),
                  )
                }
              >
                <SelectTrigger id="ep-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tSource(s.toLowerCase() as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="ep-lang">{t("preferredLang")}</Label>
              <Select
                value={draft.preferredLang}
                onValueChange={(v) => set("preferredLang", v as "RU" | "UZ")}
              >
                <SelectTrigger id="ep-lang">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RU">{t("langRu")}</SelectItem>
                  <SelectItem value="UZ">{t("langUz")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="ep-address">{t("address")}</Label>
            <Input
              id="ep-address"
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
              maxLength={500}
            />
          </div>

          <div className="grid gap-1">
            <Label htmlFor="ep-passport">{t("passport")}</Label>
            <Input
              id="ep-passport"
              value={draft.passport}
              onChange={(e) => set("passport", e.target.value)}
              maxLength={40}
            />
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
