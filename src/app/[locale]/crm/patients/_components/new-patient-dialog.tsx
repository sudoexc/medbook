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

  // Reset on close so re-opening is fresh.
  React.useEffect(() => {
    if (!open) form.reset();
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
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
        } | null;
        if (res.status === 409 && err?.reason === "phone_already_exists") {
          throw new Error("PHONE_EXISTS");
        }
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: (created) => {
      toast.success(t("createdToast"));
      queryClient.invalidateQueries({ queryKey: ["patients"] });
      onOpenChange(false);
      if (onCreated) onCreated(created.id);
    },
    onError: (e: Error) => {
      if (e.message === "PHONE_EXISTS") {
        toast.error(t("phoneExists"));
      } else {
        toast.error(t("errorToast"));
      }
    },
  });

  const submit = form.handleSubmit((values) => mutation.mutate(values));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="np-last">{t("lastName")}</Label>
              <Input
                id="np-last"
                {...form.register("lastName")}
                aria-invalid={!!form.formState.errors.lastName}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="np-first">{t("firstName")}</Label>
              <Input
                id="np-first"
                {...form.register("firstName")}
                aria-invalid={!!form.formState.errors.firstName}
              />
            </div>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="np-patronymic">{t("patronymic")}</Label>
            <Input id="np-patronymic" {...form.register("patronymic")} />
          </div>

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
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
