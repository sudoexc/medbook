"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, DoorOpenIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { doctorKey } from "../_hooks/use-doctor";

type CabinetOccupant = {
  id: string;
  nameRu: string;
  nameUz: string;
  isActive: boolean;
};

type CabinetRow = {
  id: string;
  number: string;
  floor: number | null;
  nameRu: string | null;
  nameUz: string | null;
  isActive: boolean;
  occupant: CabinetOccupant | null;
};

const cabinetsKey = ["cabinets-with-occupants"] as const;

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
  const locale = useLocale();
  const qc = useQueryClient();

  const cabinetsQuery = useQuery<CabinetRow[], Error>({
    queryKey: cabinetsKey,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetRow[] };
      return j.rows;
    },
    enabled: open,
    staleTime: 30_000,
  });

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
      qc.invalidateQueries({ queryKey: cabinetsKey });
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

  const rows = cabinetsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cabinetDialogTitle")}</DialogTitle>
          <DialogDescription>{t("cabinetDialogHint")}</DialogDescription>
        </DialogHeader>

        {cabinetsQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
          </div>
        ) : cabinetsQuery.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {t("cabinetLoadError")}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t("cabinetEmpty")}
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border rounded-md border border-border">
            {rows.map((c) => {
              const isCurrent = c.id === currentCabinetId;
              const isOccupiedByOther =
                Boolean(c.occupant) && c.occupant!.id !== doctorId;
              const isSelected = selectedId === c.id;
              const disabled = isOccupiedByOther && !isCurrent;
              const cabName =
                (locale === "uz" ? c.nameUz : c.nameRu) ?? null;
              const occupantName = c.occupant
                ? locale === "uz"
                  ? c.occupant.nameUz
                  : c.occupant.nameRu
                : null;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={disabled || save.isPending}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      "hover:bg-muted/60 focus:bg-muted/60 focus:outline-none",
                      isSelected && "bg-primary/5",
                      disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background",
                        isSelected && "border-primary text-primary",
                      )}
                    >
                      {isSelected ? (
                        <CheckIcon className="size-4" />
                      ) : (
                        <DoorOpenIcon className="size-4" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        № {c.number}
                        {cabName ? (
                          <span className="ml-2 text-muted-foreground">
                            {cabName}
                          </span>
                        ) : null}
                        {isCurrent ? (
                          <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary">
                            {t("cabinetCurrent")}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {occupantName
                          ? t("cabinetOccupiedBy", { name: occupantName })
                          : t("cabinetFree")}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

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
