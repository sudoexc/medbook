"use client";

import * as React from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  AppointmentConflictError,
  useBulkReschedule,
} from "../_hooks/use-appointment";

export interface BulkRescheduleDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedIds: string[];
  /** Called on success so the caller can clear selection. */
  onCompleted?: (count: number) => void;
}

type Direction = "forward" | "backward";

type Preset = { key: string; minutes: number };

const PRESETS: Preset[] = [
  { key: "15min", minutes: 15 },
  { key: "30min", minutes: 30 },
  { key: "1hour", minutes: 60 },
  { key: "1day", minutes: 60 * 24 },
  { key: "1week", minutes: 60 * 24 * 7 },
];

export function BulkRescheduleDialog({
  open,
  onOpenChange,
  selectedIds,
  onCompleted,
}: BulkRescheduleDialogProps) {
  const t = useTranslations("appointments.bulkReschedule");
  const tConflict = useTranslations("appointments.drawer.conflict");
  const mutation = useBulkReschedule();

  const [direction, setDirection] = React.useState<Direction>("forward");
  const [preset, setPreset] = React.useState<string>("1day");
  const [customMinutes, setCustomMinutes] = React.useState<string>("");

  React.useEffect(() => {
    if (!open) {
      setDirection("forward");
      setPreset("1day");
      setCustomMinutes("");
    }
  }, [open]);

  const deltaMinutes = React.useMemo(() => {
    let mins = 0;
    if (preset === "custom") {
      const n = Number.parseInt(customMinutes, 10);
      if (Number.isFinite(n) && n > 0) mins = n;
    } else {
      const found = PRESETS.find((p) => p.key === preset);
      mins = found?.minutes ?? 0;
    }
    return direction === "backward" ? -mins : mins;
  }, [preset, customMinutes, direction]);

  const canSubmit =
    selectedIds.length > 0 && deltaMinutes !== 0 && !mutation.isPending;

  const submit = React.useCallback(() => {
    if (!canSubmit) return;
    mutation.mutate(
      { ids: selectedIds, deltaMinutes },
      {
        onSuccess: ({ count }) => {
          toast.success(t("success", { count }));
          onOpenChange(false);
          onCompleted?.(count);
        },
        onError: (err) => {
          if (err instanceof AppointmentConflictError) {
            toast.error(
              tConflict(err.conflict.reason, {
                until: err.conflict.until ?? "",
              }),
            );
          }
        },
      },
    );
  }, [
    canSubmit,
    deltaMinutes,
    mutation,
    onCompleted,
    onOpenChange,
    selectedIds,
    t,
    tConflict,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { count: selectedIds.length })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("direction")}</Label>
            <div className="grid grid-cols-2 gap-2">
              <DirectionButton
                active={direction === "forward"}
                onClick={() => setDirection("forward")}
                label={t("forward")}
              />
              <DirectionButton
                active={direction === "backward"}
                onClick={() => setDirection("backward")}
                label={t("backward")}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>{t("amount")}</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <PresetChip
                  key={p.key}
                  active={preset === p.key}
                  onClick={() => setPreset(p.key)}
                  label={t(`presets.${p.key}` as never)}
                />
              ))}
              <PresetChip
                active={preset === "custom"}
                onClick={() => setPreset("custom")}
                label={t("presets.custom")}
              />
            </div>
            {preset === "custom" ? (
              <Input
                type="number"
                min={1}
                max={60 * 24 * 365}
                placeholder={t("customPlaceholder")}
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
              />
            ) : null}
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
          >
            {mutation.isPending ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DirectionButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}

function PresetChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
