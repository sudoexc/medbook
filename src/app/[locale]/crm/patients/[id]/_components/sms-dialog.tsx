"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone } from "@/lib/format";

export interface SmsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  phone: string;
}

export function SmsDialog({
  open,
  onOpenChange,
  patientId,
  phone,
}: SmsDialogProps) {
  const t = useTranslations("patientCard.smsDialog");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (!open) setBody("");
  }, [open]);

  const send = useMutation<{ id: string; status: string }, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/communications/sms`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, phone, body }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as { id: string; status: string };
    },
    onSuccess: () => {
      toast.success(t("sent"));
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error(e.message || t("error"));
    },
  });

  const remaining = Math.max(0, 320 - body.length);
  const canSend = body.trim().length > 0 && !send.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("to")}: {formatPhone(phone)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1">
            <label
              htmlFor="sms-body"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("body")}
            </label>
            <Textarea
              id="sms-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={320}
              placeholder={t("placeholder")}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("preview")}</span>
              <span className="tabular-nums">{remaining}</span>
            </div>
          </div>

          <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm">
            {body ? body : <span className="text-muted-foreground">—</span>}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={send.isPending}
          >
            {t("cancel")}
          </Button>
          <Button disabled={!canSend} onClick={() => send.mutate()}>
            {send.isPending ? t("sending") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
