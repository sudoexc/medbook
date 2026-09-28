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
import { groupFootprint } from "@/lib/patients/footprint-groups";

import {
  PatientDeleteBlockedError,
  useDeletePatient,
  type Patient,
} from "../_hooks/use-patient";

export interface DeletePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
}

/**
 * Confirm-dialog that requires retyping the patient's family name before
 * the delete can proceed — matches the charter's "confirm with вводом
 * фамилии" requirement.
 *
 * Only an empty card created by mistake can be deleted (audit G1-09). When
 * the server refuses, the dialog stays open and says what the card holds,
 * instead of a toast reading «HTTP 409».
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
  const [blocked, setBlocked] = React.useState<Record<string, number> | null>(
    null,
  );

  React.useEffect(() => {
    if (!open) {
      setConfirm("");
      setBlocked(null);
    }
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

        {blocked ? (
          <div
            role="alert"
            className="grid gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
          >
            <p className="font-medium text-destructive">{t("blockedTitle")}</p>
            {groupFootprint(blocked).length > 0 ? (
              <ul className="list-inside list-disc text-foreground">
                {groupFootprint(blocked).map(({ group, count }) => (
                  <li key={group}>
                    {t("blockedCount", {
                      label: t(`blockedGroups.${group}`),
                      count,
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-muted-foreground">{t("blockedBody")}</p>
          </div>
        ) : null}

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
            disabled={!canDelete || mutation.isPending || blocked !== null}
            onClick={() => {
              mutation.mutate(undefined, {
                onSuccess: () => {
                  toast.success(t("success"));
                  onOpenChange(false);
                  router.push(`/${locale}/crm/patients`);
                },
                onError: (e) => {
                  if (e instanceof PatientDeleteBlockedError) {
                    setBlocked(e.counts);
                    return;
                  }
                  toast.error(e.message || t("error"));
                },
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
