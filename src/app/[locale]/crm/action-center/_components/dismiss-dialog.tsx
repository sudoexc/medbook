"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

import { useDismissAction } from "../_hooks/use-actions";

export interface DismissDialogProps {
  actionId: string;
  trigger?: React.ReactNode;
  onDismissed?: () => void;
}

const REASON_MAX = 200;

/**
 * Reusable dismiss-with-reason dialog. The reason field is optional (free-form
 * up to 200 chars) and is forwarded to the audit log via the API. We use
 * AlertDialog rather than Dialog so dismissal is treated as a confirmation
 * step (the row leaves the OPEN list and only an admin can resurrect it).
 */
export function DismissDialog({
  actionId,
  trigger,
  onDismissed,
}: DismissDialogProps) {
  const t = useTranslations("actionCenter");
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const dismiss = useDismissAction();

  const submit = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    try {
      await dismiss.mutateAsync({
        id: actionId,
        reason: reason.trim() || undefined,
      });
      toast.success(t("dismiss.success"));
      setOpen(false);
      setReason("");
      onDismissed?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(t("dismiss.error", { reason: msg }));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
          >
            <XIcon className="size-3.5" />
            {t("actions.dismiss")}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dismiss.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dismiss.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <label
            htmlFor={`dismiss-${actionId}-reason`}
            className="text-xs font-medium text-muted-foreground"
          >
            {t("dismiss.reasonLabel")}
          </label>
          <Textarea
            id={`dismiss-${actionId}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            maxLength={REASON_MAX}
            rows={3}
            placeholder={t("dismiss.reasonPlaceholder")}
          />
          <div className="text-right text-[11px] text-muted-foreground tabular-nums">
            {reason.length} / {REASON_MAX}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={dismiss.isPending}>
            {t("dismiss.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => void submit(e)}
            disabled={dismiss.isPending}
          >
            {t("dismiss.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
