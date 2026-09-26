"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { parsePatientIdentity } from "@/lib/patients/parse-identity";
import {
  PhoneOwnerMismatchError,
  PhoneOwnerPrompt,
  readPhoneOwnerMismatch,
  type PhoneOwnerAnswer,
  type PhoneOwnerSummary,
} from "@/components/appointments/phone-owner-prompt";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const FormSchema = z.object({
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  patronymic: z.string().optional(),
  phone: z.string().min(3).max(40),
  email: z.string().email().optional().or(z.literal("")),
  birthDate: z.string().optional().or(z.literal("")),
  gender: z.enum(["MALE", "FEMALE"]).optional(),
  source: z.enum(SOURCES).optional(),
  tags: z.string().optional(),
});

type FormValues = z.infer<typeof FormSchema>;

export interface NewPatientDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (patientId: string) => void;
}

export function NewPatientDialog({
  open,
  onOpenChange,
  onCreated,
}: NewPatientDialogProps) {
  const t = useTranslations("patients.newDialog");
  const tSource = useTranslations("patients.source");
  const tGender = useTranslations("patients.gender");
  const queryClient = useQueryClient();

  const formRef = React.useRef<HTMLFormElement>(null);
  const triggerShake = React.useCallback(() => {
    const el = formRef.current;
    if (!el) return;
    el.classList.remove("motion-shake");
    void el.offsetWidth;
    el.classList.add("motion-shake");
  }, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      lastName: "",
      firstName: "",
      patronymic: "",
      phone: "",
      email: "",
      birthDate: "",
      gender: undefined,
      source: undefined,
      tags: "",
    },
  });

  // The number leads to a card with another name (a mother's phone for her
  // son) or to an unconfirmed Mini App card (audit Q-03, PH-01): staff
  // answer before anything is created. Any edit to the form withdraws it.
  const [ownerConflict, setOwnerConflict] =
    React.useState<PhoneOwnerSummary | null>(null);
  React.useEffect(() => {
    const sub = form.watch(() => setOwnerConflict(null));
    return () => sub.unsubscribe();
  }, [form]);

  // Reset on close so re-opening is fresh.
  React.useEffect(() => {
    if (!open) {
      form.reset();
      setOwnerConflict(null);
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: async ({
      values,
      phoneOwner,
    }: {
      values: FormValues;
      phoneOwner?: PhoneOwnerAnswer;
    }) => {
      const fullName = [values.lastName, values.firstName, values.patronymic]
        .filter(Boolean)
        .join(" ")
        .trim();
      const body = {
        fullName,
        phone: values.phone,
        birthDate: values.birthDate ? new Date(values.birthDate) : undefined,
        gender: values.gender,
        source: values.source,
        tags: values.tags
          ? values.tags
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : undefined,
        ...(phoneOwner ? { phoneOwner } : {}),
      };
      const res = await fetch("/api/crm/patients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          patientId?: string;
        } | null;
        const owner = readPhoneOwnerMismatch(res.status, err);
        if (owner) throw new PhoneOwnerMismatchError(owner);
        if (res.status === 409 && err?.reason === "phone_already_exists") {
          // Staff answered «this is the same person» (or the number's
          // owner matched outright): the card exists, so open it instead of
          // failing with «номер уже занят».
          if (err.patientId) return { id: err.patientId, existing: true };
          throw new Error("PHONE_EXISTS");
        }
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string; existing?: boolean };
    },
    onSuccess: (created) => {
      toast.success(created.existing ? t("existingToast") : t("createdToast"));
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      onOpenChange(false);
      if (onCreated) onCreated(created.id);
    },
    onError: (e: Error) => {
      if (e instanceof PhoneOwnerMismatchError) {
        setOwnerConflict(e.owner);
        return;
      }
      triggerShake();
      if (e.message === "PHONE_EXISTS") {
        toast.error(t("phoneExists"));
      } else {
        toast.error(t("errorToast"));
      }
    },
  });

  const submit = form.handleSubmit(
    (values) => mutation.mutate({ values }),
    () => triggerShake(),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="np-last">{t("lastName")}</Label>
              <Input
                id="np-last"
                {...form.register("lastName")}
                aria-invalid={!!form.formState.errors.lastName}
              />
              {form.formState.errors.lastName ? (
                <p className="motion-error-in text-xs text-destructive">
                  {t("errorRequired")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="np-first">{t("firstName")}</Label>
              <Input
                id="np-first"
                {...form.register("firstName")}
                aria-invalid={!!form.formState.errors.firstName}
              />
              {form.formState.errors.firstName ? (
                <p className="motion-error-in text-xs text-destructive">
                  {t("errorRequired")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="np-patronymic">{t("patronymic")}</Label>
            <Input id="np-patronymic" {...form.register("patronymic")} />
          </div>

          <BirthYearInNameHint
            lastName={form.watch("lastName")}
            firstName={form.watch("firstName")}
            patronymic={form.watch("patronymic")}
            hasExplicitBirthDate={Boolean(form.watch("birthDate"))}
          />

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="np-phone">{t("phone")}</Label>
              <Input
                id="np-phone"
                type="tel"
                placeholder="+998 90 123 45 67"
                {...form.register("phone")}
                aria-invalid={!!form.formState.errors.phone}
              />
              {form.formState.errors.phone ? (
                <p className="motion-error-in text-xs text-destructive">
                  {t("errorPhoneFormat")}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="np-email">{t("email")}</Label>
              <Input id="np-email" type="email" {...form.register("email")} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="np-dob">{t("birthDate")}</Label>
              <Input id="np-dob" type="date" {...form.register("birthDate")} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="np-gender">{t("gender")}</Label>
              <Select
                value={form.watch("gender") ?? ""}
                onValueChange={(v) =>
                  form.setValue("gender", v ? (v as "MALE" | "FEMALE") : undefined)
                }
              >
                <SelectTrigger id="np-gender">
                  <SelectValue placeholder={t("genderPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">{tGender("male")}</SelectItem>
                  <SelectItem value="FEMALE">{tGender("female")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="np-source">{t("source")}</Label>
            <Select
              value={form.watch("source") ?? ""}
              onValueChange={(v) =>
                form.setValue(
                  "source",
                  v ? (v as (typeof SOURCES)[number]) : undefined,
                )
              }
            >
              <SelectTrigger id="np-source">
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

          <div className="grid gap-1">
            <Label htmlFor="np-tags">{t("tags")}</Label>
            <Input
              id="np-tags"
              {...form.register("tags")}
              placeholder={t("tagsPlaceholder")}
            />
          </div>

          {ownerConflict ? (
            <PhoneOwnerPrompt
              owner={ownerConflict}
              pending={mutation.isPending}
              onAnswer={(answer) =>
                mutation.mutate({ values: form.getValues(), phoneOwner: answer })
              }
            />
          ) : null}

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || ownerConflict !== null}
            >
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The front desk types the way the clinic speaks: «Турматов Отабек 1969»,
 * year and all, often into the surname box. The server strips that year into
 * a real birth date (POST /api/crm/patients) — this line makes the silent
 * rewrite visible, so nobody wonders where the digits went. Nothing is
 * shown when the form already carries an explicit birth date: that one wins.
 */
function BirthYearInNameHint({
  lastName,
  firstName,
  patronymic,
  hasExplicitBirthDate,
}: {
  lastName?: string;
  firstName?: string;
  patronymic?: string;
  hasExplicitBirthDate: boolean;
}) {
  const t = useTranslations("patients.newDialog");
  const joined = [lastName, firstName, patronymic]
    .filter(Boolean)
    .join(" ")
    .trim();
  const parsed = parsePatientIdentity(joined);
  if (!parsed.matched || parsed.birthYear === null) return null;

  return (
    <p className="rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-[11px] leading-snug text-foreground">
      {hasExplicitBirthDate
        ? t("yearInNameIgnored", { year: parsed.birthYear })
        : t("yearInNameParsed", {
            name: parsed.fullName,
            year: parsed.birthYear,
          })}
    </p>
  );
}
