"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
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
import { normalizeTicketPrefix } from "@/server/services/ticket-number";

import { doctorKey } from "../_hooks/use-doctor";

export interface TicketPrefixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctorId: string;
  current: string | null;
}

/**
 * Admin override of the letter in front of a doctor's queue tickets (audit
 * Q-12). A new doctor gets the clinic's next free letter automatically; this
 * is for matching the letters to something the clinic already uses, like
 * the cabinet signs. Uniqueness is enforced by the server.
 */
export function TicketPrefixDialog({
  open,
  onOpenChange,
  doctorId,
  current,
}: TicketPrefixDialogProps) {
  const t = useTranslations("crmDoctors.profile");
  const tc = useTranslations("common");
  const qc = useQueryClient();

  const [value, setValue] = React.useState(current ?? "");
  React.useEffect(() => {
    if (open) setValue(current ?? "");
  }, [open, current]);

  const normalized = normalizeTicketPrefix(value);

  const save = useMutation<unknown, Error, string>({
    mutationFn: async (ticketPrefix) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketPrefix }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
        } | null;
        if (res.status === 409 && j?.reason === "ticket_prefix_taken") {
          throw new Error(t("ticketPrefixTaken"));
        }
        // Zod refusal (the route answers 400 ValidationError).
        if (res.status === 400) throw new Error(t("ticketPrefixInvalid"));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      toast.success(t("ticketPrefixSaved"));
      qc.invalidateQueries({ queryKey: doctorKey(doctorId) });
      qc.invalidateQueries({ queryKey: ["doctors", "list"] });
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalized) return;
    if (normalized === current) {
      onOpenChange(false);
      return;
    }
    save.mutate(normalized);
  };

  const showInvalid = value.trim() !== "" && !normalized;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{t("ticketPrefixDialogTitle")}</DialogTitle>
            <DialogDescription>{t("ticketPrefixDialogHint")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2 py-4">
            <Label htmlFor="ticket-prefix">{t("ticketPrefixInputLabel")}</Label>
            <Input
              id="ticket-prefix"
              value={value}
              onChange={(e) => setValue(e.target.value.toUpperCase())}
              maxLength={2}
              autoComplete="off"
              autoFocus
              aria-invalid={showInvalid}
              className="w-24 font-mono text-lg uppercase tracking-widest"
              disabled={save.isPending}
            />
            {showInvalid ? (
              <p className="text-xs text-destructive">{t("ticketPrefixInvalid")}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={save.isPending}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={save.isPending || !normalized}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
