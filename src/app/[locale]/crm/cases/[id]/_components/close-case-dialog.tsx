"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import type { CaseStatus } from "../_hooks/use-case";

type ReasonKey = "RESOLVED" | "ABANDONED" | "TRANSFERRED" | "OTHER";

const REASONS: {
  key: ReasonKey;
  status: CaseStatus;
  tKey:
    | "closeDialogReasonResolved"
    | "closeDialogReasonAbandoned"
    | "closeDialogReasonTransferred"
    | "closeDialogReasonOther";
}[] = [
  { key: "RESOLVED", status: "RESOLVED", tKey: "closeDialogReasonResolved" },
  { key: "ABANDONED", status: "ABANDONED", tKey: "closeDialogReasonAbandoned" },
  { key: "TRANSFERRED", status: "TRANSFERRED", tKey: "closeDialogReasonTransferred" },
  { key: "OTHER", status: "RESOLVED", tKey: "closeDialogReasonOther" },
];

export interface CloseCaseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (status: CaseStatus, reason: string) => Promise<void>;
}

/**
 * "Закрыть случай" confirmation dialog.
 *
 * Three canned reasons map to the three terminal statuses (RESOLVED,
 * ABANDONED, TRANSFERRED). The "Other" radio routes to RESOLVED with the
 * free-text reason — closing for an unspecified-but-resolved reason is the
 * closest semantic match, and the audit log preserves the operator's text.
 *
 * The free-text textarea is always editable (not just under "Other") so
 * staff can append context to any of the canned options before confirming.
 */
export function CloseCaseDialog({
  open,
  onOpenChange,
  onSubmit,
}: CloseCaseDialogProps) {
  const t = useTranslations("cases.detail");
  const [reason, setReason] = React.useState<ReasonKey>("RESOLVED");
  const [text, setText] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setReason("RESOLVED");
      setText("");
      setPending(false);
    }
  }, [open]);

  const submit = async () => {
    const picked = REASONS.find((r) => r.key === reason)!;
    const reasonText = text.trim() || t(picked.tKey);
    setPending(true);
    try {
      await onSubmit(picked.status, reasonText);
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("closeDialogTitle")}</DialogTitle>
          <DialogDescription>{t("closeDialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <RadioGroup
            value={reason}
            onValueChange={(v) => setReason(v as ReasonKey)}
            className="gap-1.5"
          >
            {REASONS.map((r) => (
              <div key={r.key} className="flex items-center gap-2">
                <RadioGroupItem id={`close-reason-${r.key}`} value={r.key} />
                <Label
                  htmlFor={`close-reason-${r.key}`}
                  className="cursor-pointer text-sm font-normal"
                >
                  {t(r.tKey)}
                </Label>
              </div>
            ))}
          </RadioGroup>

          <div className="grid gap-1">
            <Label htmlFor="close-reason-text" className="text-xs font-medium">
              {t("closeDialogReasonLabel")}
            </Label>
            <Textarea
              id="close-reason-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("closeDialogReasonPlaceholder")}
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("closeCancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={pending}>
            {pending ? "…" : t("closeSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
