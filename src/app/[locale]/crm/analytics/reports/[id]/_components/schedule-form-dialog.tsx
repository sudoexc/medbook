"use client";

/**
 * Phase 18 Wave 4 — create / edit modal for ScheduledReport rows.
 *
 * Shared between the "Создать расписание" and "Редактировать" entry points;
 * the parent passes an optional `initial` row and a `mode`. Validation is
 * intentionally light client-side (presence + channel-specific shape) — the
 * server is the source of truth and returns `invalid_email` /
 * `invalid_telegram_chat_id` for anything that slips through.
 */
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cadenceLabel, type ScheduleCadence } from "@/server/analytics/cadence";

export type ScheduleChannel = "EMAIL" | "TELEGRAM";
export type ScheduleFormat = "pdf" | "csv";

export interface ScheduleFormValues {
  cadence: ScheduleCadence;
  deliveryChannel: ScheduleChannel;
  deliveryTarget: string;
  format: ScheduleFormat;
  enabled: boolean;
}

export interface ScheduleFormDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  locale: "ru" | "uz";
  initial?: Partial<ScheduleFormValues>;
  onSubmit: (values: ScheduleFormValues) => Promise<void>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TG_CHAT_ID_RE = /^-?\d{4,20}$/;

const DEFAULT: ScheduleFormValues = {
  cadence: "WEEKLY",
  deliveryChannel: "EMAIL",
  deliveryTarget: "",
  format: "pdf",
  enabled: false,
};

export function ScheduleFormDialog({
  open,
  onOpenChange,
  mode,
  locale,
  initial,
  onSubmit,
}: ScheduleFormDialogProps): React.JSX.Element {
  const t = useTranslations("analyticsReports.schedules");
  const [values, setValues] = React.useState<ScheduleFormValues>({
    ...DEFAULT,
    ...initial,
  });
  const [pending, setPending] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues({ ...DEFAULT, ...initial });
      setPending(false);
      setTouched(false);
    }
  }, [open, initial]);

  const targetTrimmed = values.deliveryTarget.trim();
  const targetValid =
    values.deliveryChannel === "EMAIL"
      ? EMAIL_RE.test(targetTrimmed)
      : TG_CHAT_ID_RE.test(targetTrimmed);

  const submit = async () => {
    setTouched(true);
    if (!targetValid) return;
    setPending(true);
    try {
      await onSubmit({ ...values, deliveryTarget: targetTrimmed });
    } finally {
      setPending(false);
    }
  };

  const cadences: ScheduleCadence[] = ["DAILY", "WEEKLY", "MONTHLY"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? t("dialogTitleCreate") : t("dialogTitleEdit")}
          </DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Cadence */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">{t("cadenceLabel")}</Label>
            <RadioGroup
              value={values.cadence}
              onValueChange={(v) =>
                setValues((p) => ({ ...p, cadence: v as ScheduleCadence }))
              }
              className="gap-1.5"
            >
              {cadences.map((c) => (
                <div key={c} className="flex items-center gap-2">
                  <RadioGroupItem id={`schedule-cadence-${c}`} value={c} />
                  <Label
                    htmlFor={`schedule-cadence-${c}`}
                    className="cursor-pointer text-sm font-normal"
                  >
                    {cadenceLabel(c, locale)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Channel */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">{t("channelLabel")}</Label>
            <Select
              value={values.deliveryChannel}
              onValueChange={(v) =>
                setValues((p) => ({
                  ...p,
                  deliveryChannel: v as ScheduleChannel,
                  // When switching away from a known-good target keep the
                  // text — server revalidates anyway.
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EMAIL">{t("channelEmail")}</SelectItem>
                <SelectItem value="TELEGRAM">{t("channelTelegram")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Target */}
          <div className="grid gap-1.5">
            <Label htmlFor="schedule-target" className="text-xs font-medium">
              {values.deliveryChannel === "EMAIL"
                ? t("targetEmailLabel")
                : t("targetTelegramLabel")}
            </Label>
            <Input
              id="schedule-target"
              value={values.deliveryTarget}
              onChange={(e) =>
                setValues((p) => ({ ...p, deliveryTarget: e.target.value }))
              }
              placeholder={
                values.deliveryChannel === "EMAIL"
                  ? "ops@example.com"
                  : "-1001234567890"
              }
              maxLength={255}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {values.deliveryChannel === "EMAIL"
                ? t("targetEmailHint")
                : t("targetTelegramHint")}
            </p>
            {touched && !targetValid ? (
              <p className="text-xs text-destructive">
                {values.deliveryChannel === "EMAIL"
                  ? t("targetInvalidEmail")
                  : t("targetInvalidTelegram")}
              </p>
            ) : null}
          </div>

          {/* Format */}
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium">{t("formatLabel")}</Label>
            <RadioGroup
              value={values.format}
              onValueChange={(v) =>
                setValues((p) => ({ ...p, format: v as ScheduleFormat }))
              }
              className="flex gap-3"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem id="schedule-format-pdf" value="pdf" />
                <Label
                  htmlFor="schedule-format-pdf"
                  className="cursor-pointer text-sm font-normal"
                >
                  {t("formatPdf")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id="schedule-format-csv" value="csv" />
                <Label
                  htmlFor="schedule-format-csv"
                  className="cursor-pointer text-sm font-normal"
                >
                  {t("formatCsv")}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Enabled toggle (edit only — create defaults to disabled per spec) */}
          {mode === "edit" ? (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="schedule-enabled"
                checked={values.enabled}
                onChange={(e) =>
                  setValues((p) => ({ ...p, enabled: e.target.checked }))
                }
                className="size-4"
              />
              <Label
                htmlFor="schedule-enabled"
                className="cursor-pointer text-sm font-normal"
              >
                {t("enabledLabel")}
              </Label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("createDisabledHint")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={pending || (touched && !targetValid)}
          >
            {pending ? "…" : mode === "create" ? t("submitCreate") : t("submitEdit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
