"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { UsersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * «This number already belongs to someone else — same person?» (audit Q-03).
 *
 * A walk-in typed as name + phone used to land silently in whichever card
 * held the number, so a son registered with his mother's phone was treated
 * in her record. `/api/crm/appointments/walkin` now answers 409
 * `phone_owner_mismatch` with the owner, and the doctor's and the front
 * desk's dialogs render this prompt; the chosen answer is re-sent as
 * `phoneOwner`.
 */
export type PhoneOwnerSummary = {
  id: string;
  fullName: string;
  birthYear: number | null;
};

export type PhoneOwnerAnswer = "same" | "other";

/** Thrown by a dialog's mutation so `onError` can show the prompt. */
export class PhoneOwnerMismatchError extends Error {
  constructor(readonly owner: PhoneOwnerSummary) {
    super("PHONE_OWNER_MISMATCH");
    this.name = "PhoneOwnerMismatchError";
  }
}

/** The owner from a walk-in 409 body, or null for any other error. */
export function readPhoneOwnerMismatch(
  status: number,
  body: unknown,
): PhoneOwnerSummary | null {
  if (status !== 409 || !body || typeof body !== "object") return null;
  const b = body as { reason?: unknown; owner?: unknown };
  if (b.reason !== "phone_owner_mismatch") return null;
  const o = b.owner as Partial<PhoneOwnerSummary> | undefined;
  if (!o || typeof o.id !== "string" || typeof o.fullName !== "string") return null;
  return {
    id: o.id,
    fullName: o.fullName,
    birthYear: typeof o.birthYear === "number" ? o.birthYear : null,
  };
}

export function PhoneOwnerPrompt({
  owner,
  pending,
  onAnswer,
}: {
  owner: PhoneOwnerSummary;
  pending?: boolean;
  onAnswer: (answer: PhoneOwnerAnswer) => void;
}) {
  const t = useTranslations("patients.phoneOwner");
  return (
    <div
      role="alert"
      className="grid gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <p className="flex items-center gap-2 font-medium text-foreground">
        <UsersIcon className="size-4 shrink-0" />
        {t("title")}
      </p>
      <p className="text-muted-foreground">
        {owner.birthYear !== null
          ? t("bodyWithYear", { name: owner.fullName, year: owner.birthYear })
          : t("body", { name: owner.fullName })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onAnswer("same")}
        >
          {t("same")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() => onAnswer("other")}
        >
          {t("other")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("otherHint")}</p>
    </div>
  );
}
