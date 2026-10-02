"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateText } from "@/components/atoms/date-text";

import type { DoctorDetail } from "../_hooks/use-doctor";
import {
  useCreateTimeOff,
  useDeleteTimeOff,
  type TimeOffAffected,
} from "../_hooks/use-doctor-schedule";

/**
 * The appointments list narrowed to this doctor and the visits inside the
 * new leave, where reception reschedules them in bulk.
 */
export function affectedAppointmentsHref(
  locale: string,
  doctorId: string,
  affected: TimeOffAffected,
): string | null {
  if (!affected.firstAt || !affected.lastAt) return null;
  const sp = new URLSearchParams({
    doctorId,
    dateMode: "range",
    from: affected.firstAt,
    // Inclusive of the last visit's own start minute.
    to: new Date(Date.parse(affected.lastAt) + 60_000).toISOString(),
  });
  return `/${locale}/crm/appointments?${sp.toString()}`;
}

function localDateTimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function defaultStart(): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return localDateTimeInputValue(d.toISOString());
}

function defaultEnd(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  return localDateTimeInputValue(d.toISOString());
}

export interface DoctorTimeOffProps {
  doctor: DoctorDetail;
  /** False for roles the time-off API refuses (audit DR-15): list only. */
  canEdit: boolean;
  className?: string;
}

export function DoctorTimeOff({ doctor, canEdit, className }: DoctorTimeOffProps) {
  const t = useTranslations("crmDoctors.timeOff");
  const locale = useLocale();
  const router = useRouter();

  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState(() => ({
    startAt: defaultStart(),
    endAt: defaultEnd(),
    reason: "",
  }));
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  const createMut = useCreateTimeOff(doctor.id);
  const deleteMut = useDeleteTimeOff(doctor.id);

  const endBeforeStart =
    form.startAt && form.endAt && new Date(form.endAt) <= new Date(form.startAt);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (endBeforeStart) {
      toast.error(t("errorEndBeforeStart"));
      return;
    }
    createMut.mutate(
      {
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        reason: form.reason || null,
      },
      {
        onSuccess: (created) => {
          toast.success(t("saved"));
          // Visits already booked inside the leave stay on the books and keep
          // reminding patients: never silent (DR-06).
          const affected = created.affectedAppointments;
          if (affected && affected.count > 0) {
            const href = affectedAppointmentsHref(locale, doctor.id, affected);
            toast.warning(t("affectedAppointments", { count: affected.count }), {
              duration: 15_000,
              ...(href
                ? {
                    action: {
                      label: t("affectedOpen"),
                      onClick: () => router.push(href),
                    },
                  }
                : {}),
            });
          }
          setAdding(false);
          setForm({
            startAt: defaultStart(),
            endAt: defaultEnd(),
            reason: "",
          });
        },
        onError: (err) => toast.error(err.message || t("errorSave")),
      },
    );
  };

  const confirmDelete = () => {
    if (!pendingDeleteId) return;
    deleteMut.mutate(pendingDeleteId);
    setPendingDeleteId(null);
  };

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        {canEdit && !adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            {t("add")}
          </Button>
        ) : null}
      </div>

      {canEdit && adding ? (
        <form
          onSubmit={onSubmit}
          className="mb-3 grid gap-2 rounded-md border border-border bg-background p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="to-start">{t("startAt")}</Label>
              <Input
                id="to-start"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) =>
                  setForm((s) => ({ ...s, startAt: e.target.value }))
                }
                required
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="to-end">{t("endAt")}</Label>
              <Input
                id="to-end"
                type="datetime-local"
                value={form.endAt}
                onChange={(e) =>
                  setForm((s) => ({ ...s, endAt: e.target.value }))
                }
                required
                aria-invalid={endBeforeStart || undefined}
              />
              {endBeforeStart ? (
                <p className="text-xs text-destructive">
                  {t("errorEndBeforeStart")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="to-reason">{t("reason")}</Label>
            <Textarea
              id="to-reason"
              rows={2}
              value={form.reason}
              onChange={(e) =>
                setForm((s) => ({ ...s, reason: e.target.value }))
              }
              placeholder={t("reasonPlaceholder")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAdding(false)}
              disabled={createMut.isPending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMut.isPending || !!endBeforeStart}
            >
              {t("save")}
            </Button>
          </div>
        </form>
      ) : null}

      {doctor.timeOffs.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {doctor.timeOffs.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  <DateText date={row.startAt} style="short" />
                  {" – "}
                  <DateText date={row.endAt} style="short" />
                </div>
                {row.reason ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {row.reason}
                  </div>
                ) : null}
              </div>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("delete")}
                  onClick={() => setPendingDeleteId(row.id)}
                  disabled={deleteMut.isPending}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={!!pendingDeleteId}
        onOpenChange={(o) => !o && setPendingDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirmDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
