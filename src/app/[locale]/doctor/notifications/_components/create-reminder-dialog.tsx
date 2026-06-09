"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";

import { useCreateReminder } from "../_hooks/use-doctor-reminders";
import {
  ReminderPatientPicker,
  type PickedPatient,
} from "./reminder-patient-picker";

/**
 * Returns `yyyy-MM-ddTHH:mm` for the given Date in local time — the format
 * `<input type="datetime-local">` expects (no timezone, browser-local).
 */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultRemindAt(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  d.setMinutes(0, 0, 0);
  return toLocalInputValue(d);
}

export function CreateReminderDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const t = useTranslations("doctor.notifications");
  const create = useCreateReminder();
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [remindAt, setRemindAt] = React.useState<string>(() =>
    defaultRemindAt(),
  );
  const [patient, setPatient] = React.useState<PickedPatient | null>(null);

  // Reset form whenever the dialog reopens — avoids stale state if the
  // doctor cancels and starts over.
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setBody("");
      setRemindAt(defaultRemindAt());
      setPatient(null);
    }
  }, [open]);

  const titleTrim = title.trim();
  const remindAtIso = remindAt ? new Date(remindAt).toISOString() : "";
  const canSubmit = titleTrim.length > 0 && remindAt.length > 0 && !create.isPending;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await create.mutateAsync({
        title: titleTrim,
        body: body.trim() ? body.trim() : null,
        remindAt: remindAtIso,
        patientId: patient?.id ?? null,
      });
      toast.success(t("create.success"));
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("create.error");
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>{t("create.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="reminder-title">{t("create.titleLabel")}</Label>
            <Input
              id="reminder-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("create.titlePlaceholder")}
              maxLength={200}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reminder-body">{t("create.bodyLabel")}</Label>
            <Textarea
              id="reminder-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("create.bodyPlaceholder")}
              rows={3}
              maxLength={5000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reminder-at">{t("create.remindAtLabel")}</Label>
            <Input
              id="reminder-at"
              type="datetime-local"
              value={remindAt}
              onChange={(e) => setRemindAt(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t("create.patientLabel")}</Label>
            <ReminderPatientPicker value={patient} onChange={setPatient} />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t("actions.cancel")}
            </DialogClose>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending ? (
                <Loader2Icon className="mr-1.5 size-4 animate-spin" />
              ) : null}
              {t("actions.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
