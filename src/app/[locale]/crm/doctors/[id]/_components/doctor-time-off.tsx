"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DateText } from "@/components/atoms/date-text";

import type { DoctorDetail } from "../_hooks/use-doctor";
import {
  useCreateTimeOff,
  useDeleteTimeOff,
} from "../_hooks/use-doctor-schedule";

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
  className?: string;
}

export function DoctorTimeOff({ doctor, className }: DoctorTimeOffProps) {
  const t = useTranslations("crmDoctors.timeOff");

  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState(() => ({
    startAt: defaultStart(),
    endAt: defaultEnd(),
    reason: "",
  }));

  const createMut = useCreateTimeOff(doctor.id);
  const deleteMut = useDeleteTimeOff(doctor.id);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMut.mutate(
      {
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        reason: form.reason || null,
      },
      {
        onSuccess: () => {
          toast.success(t("saved"));
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

  const onDelete = (id: string) => {
    if (!confirm(t("deleteConfirm"))) return;
    deleteMut.mutate(id);
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
        {!adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon className="size-4" />
            {t("add")}
          </Button>
        ) : null}
      </div>

      {adding ? (
        <form
          onSubmit={onSubmit}
          className="mb-3 grid gap-2 rounded-md border border-border bg-background p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label>{t("startAt")}</Label>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) =>
                  setForm((s) => ({ ...s, startAt: e.target.value }))
                }
                required
              />
            </div>
            <div className="grid gap-1">
              <Label>{t("endAt")}</Label>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) =>
                  setForm((s) => ({ ...s, endAt: e.target.value }))
                }
                required
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("reason")}</Label>
            <Textarea
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
            <Button type="submit" size="sm" disabled={createMut.isPending}>
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
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("delete")}
                onClick={() => onDelete(row.id)}
                disabled={deleteMut.isPending}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
