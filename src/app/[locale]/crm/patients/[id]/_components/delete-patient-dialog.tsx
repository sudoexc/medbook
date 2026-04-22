"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
import { Input } from "@/components/ui/input";

import { useDeletePatient, type Patient } from "../_hooks/use-patient";

export interface DeletePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
}

/**
 * Confirm-dialog that requires retyping the patient's family name before
 * the delete can proceed — matches the charter's "confirm with вводом
 * фамилии" requirement.
 */
export function DeletePatientDialog({
  open,
  onOpenChange,
  patient,
}: DeletePatientDialogProps) {
  const t = useTranslations("patientCard.delete");
  const router = useRouter();
  const locale = useLocale();
  const [confirm, setConfirm] = React.useState("");

  React.useEffect(() => {
    if (!open) setConfirm("");
  }, [open]);

  const mutation = useDeletePatient(patient.id);

  const expected =
    patient.fullName.trim().split(/\s+/)[0]?.trim().toLowerCase() ?? "";
  const entered = confirm.trim().toLowerCase();
  const canDelete = expected.length > 0 && entered === expected;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">{t("title")}</DialogTitle>
          <DialogDescription>{t("warning")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1">
          <label
            htmlFor="delete-confirm"
            className="text-xs font-medium text-muted-foreground"
          >
            {t("confirmLabel", { surname: patient.fullName.split(" ")[0] ?? "" })}
          </label>
          <Input
            id="delete-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("confirmPlaceholder")}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!canDelete || mutation.isPending}
            onClick={() => {
              mutation.mutate(undefined, {
                onSuccess: () => {
                  toast.success(t("success"));
                  onOpenChange(false);
                  router.push(`/${locale}/crm/patients`);
                },
                onError: (e) => toast.error(e.message || t("error")),
              });
            }}
          >
            {mutation.isPending ? t("deleting") : t("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
