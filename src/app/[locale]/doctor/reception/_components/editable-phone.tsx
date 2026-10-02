"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon, PencilIcon, PhoneIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { isValidCardPhone } from "@/lib/phone";

/** Why a typed number cannot be saved, or null when it can (VW-26). */
export function phoneEditProblem(value: string): "phoneRequired" | "phoneInvalid" | null {
  const next = value.trim();
  if (!next) return "phoneRequired";
  return isValidCardPhone(next) ? null : "phoneInvalid";
}

/**
 * The message key for a refused save. The raw error text («ValidationError»,
 * «conflict») meant nothing to the doctor; a number already on another card
 * is said as such, anything else is the generic failure.
 */
export function phoneSaveErrorKey(reason: string | null | undefined): "phoneTaken" | "phoneSaveFailed" {
  return reason === "phone_taken" || reason === "phone_or_telegram_taken"
    ? "phoneTaken"
    : "phoneSaveFailed";
}

class PhoneSaveError extends Error {
  constructor(readonly reason: string | null) {
    super(reason ?? "phone_save_failed");
  }
}

/**
 * Inline phone correction on the visit header.
 *
 * The doctor sees the number right here while the patient is in front of him,
 * and a digit mistyped at registration is caught exactly at this moment — not
 * later on the patient card two screens away. The phone drives reminders and
 * the Telegram Mini App link, so leaving it wrong is expensive.
 *
 * A pencil appears on hover; click turns the number into a field, Enter or the
 * check saves, Escape cancels. Deliberately not a dialog: a dialog over a live
 * visit is heavier than the edit itself.
 */
export function EditablePhone({
  patientId,
  phone,
}: {
  patientId: string;
  phone: string | null;
}) {
  const t = useTranslations("doctor.reception.activePatient");
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(phone ?? "");

  React.useEffect(() => {
    if (!editing) setValue(phone ?? "");
  }, [phone, editing]);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/crm/patients/${patientId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { reason?: string } | null;
        throw new PhoneSaveError(j?.reason ?? null);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("phoneSaved"));
      // The number is denormalised into the day's projection, the queue rows
      // and the patient summary — refetch broadly rather than guess.
      void qc.invalidateQueries({ queryKey: ["doctor"] });
      setEditing(false);
    },
    onError: (e: Error) =>
      toast.error(
        t(phoneSaveErrorKey(e instanceof PhoneSaveError ? e.reason : null)),
      ),
  });

  // Checked before anything is sent (VW-26): a cleared field went out as
  // `phone: null`, which the API refuses, and the doctor saw «ValidationError».
  // A card keeps a number; clearing the field is not a way to remove it.
  const submit = () => {
    if (save.isPending) return;
    const problem = phoneEditProblem(value);
    if (problem) {
      toast.error(t(problem));
      return;
    }
    save.mutate(value.trim());
  };

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1.5 tabular-nums">
        {phone || "—"}
        <PhoneIcon className="size-3.5 text-muted-foreground" />
        <button
          type="button"
          aria-label={t("phoneEdit")}
          title={t("phoneEdit")}
          onClick={() => {
            setValue(phone ?? "");
            setEditing(true);
          }}
          className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
        >
          <PencilIcon className="size-3.5" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="tel"
        inputMode="tel"
        autoFocus
        value={value}
        maxLength={20}
        disabled={save.isPending}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
        className="h-7 w-40 rounded-md border border-border bg-background px-2 text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
      />
      <button
        type="button"
        aria-label={t("phoneSave")}
        disabled={save.isPending}
        onClick={submit}
        className="inline-flex size-6 items-center justify-center rounded-md text-success transition-colors hover:bg-success/10 disabled:opacity-60"
      >
        {save.isPending ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        aria-label={t("phoneCancel")}
        disabled={save.isPending}
        onClick={() => setEditing(false)}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}
