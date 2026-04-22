"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { LockKeyholeIcon } from "lucide-react";

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

/**
 * Small re-entry prompt: "enter your current password" before committing a
 * secret change. The parent receives the password on submit and bundles it
 * into the follow-up mutation (server verifies via bcrypt compare).
 */
export interface PasswordReentryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (password: string) => Promise<void> | void;
  title?: React.ReactNode;
  description?: React.ReactNode;
}

export function PasswordReentryDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
}: PasswordReentryDialogProps) {
  const t = useTranslations("settings");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function handleConfirm() {
    setError(null);
    if (password.length < 1) {
      setError(t("passwordReentry.required"));
      return;
    }
    setBusy(true);
    try {
      await onConfirm(password);
    } catch (e) {
      setError((e as Error).message || t("passwordReentry.wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyholeIcon className="size-4 text-primary" />
            {title ?? t("passwordReentry.title")}
          </DialogTitle>
          <DialogDescription>
            {description ?? t("passwordReentry.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="pw-reentry">
            {t("passwordReentry.label")}
          </Label>
          <Input
            id="pw-reentry"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) {
                e.preventDefault();
                void handleConfirm();
              }
            }}
          />
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={busy}>
            {busy ? t("common.saving") : t("common.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
