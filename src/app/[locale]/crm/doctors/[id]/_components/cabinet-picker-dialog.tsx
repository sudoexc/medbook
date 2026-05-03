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

import {
  CABINETS_WITH_OCCUPANTS_KEY,
  CabinetSelectField,
} from "../../_components/cabinet-select-field";
import { doctorKey } from "../_hooks/use-doctor";

export interface CabinetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctorId: string;
  /** Currently bound cabinet — selected by default; never disabled. */
  currentCabinetId: string;
}

export function CabinetPickerDialog({
  open,
  onOpenChange,
  doctorId,
  currentCabinetId,
}: CabinetPickerDialogProps) {
  const t = useTranslations("crmDoctors.profile");
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = React.useState<string>(currentCabinetId);
  React.useEffect(() => {
    if (open) setSelectedId(currentCabinetId);
  }, [open, currentCabinetId]);

  const save = useMutation<unknown, Error, string>({
    mutationFn: async (cabinetId) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cabinetId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
        } | null;
        if (res.status === 409 && j?.reason === "cabinet_taken") {
          throw new Error(t("cabinetTaken"));
        }
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
    },
    onSuccess: () => {
      toast.success(t("cabinetSaved"));
      qc.invalidateQueries({ queryKey: doctorKey(doctorId) });
      qc.invalidateQueries({ queryKey: CABINETS_WITH_OCCUPANTS_KEY });
      qc.invalidateQueries({ queryKey: ["doctors", "list"] });
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error(e.message);
    },
  });

  const onSave = () => {
    if (selectedId === currentCabinetId) {
      onOpenChange(false);
      return;
    }
    save.mutate(selectedId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cabinetDialogTitle")}</DialogTitle>
          <DialogDescription>{t("cabinetDialogHint")}</DialogDescription>
        </DialogHeader>

        <CabinetSelectField
          value={selectedId}
          onChange={setSelectedId}
          currentCabinetId={currentCabinetId}
          disabled={save.isPending}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            {t("cabinetCancel")}
          </Button>
          <Button
            onClick={onSave}
            disabled={save.isPending || selectedId === currentCabinetId}
          >
            {t("cabinetSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
