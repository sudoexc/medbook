"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  ClockIcon,
  ExternalLinkIcon,
  PhoneIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDate, type Locale } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyText } from "@/components/atoms/money-text";
import { PhoneText } from "@/components/atoms/phone-text";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";

import {
  AppointmentConflictError,
  useAppointment,
  useDeleteAppointment,
  usePatchAppointment,
  useSetQueueStatus,
} from "../_hooks/use-appointment";
import { paymentStatusFor } from "../_hooks/use-appointments-list";
import {
  actionsFor,
  nextStatuses,
  type AppointmentStatus,
} from "@/lib/appointment-transitions";

const STATUSES = [
  "BOOKED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "NO_SHOW",
] as const;

const CHANNELS = ["WALKIN", "PHONE", "TELEGRAM", "WEBSITE", "KIOSK"] as const;

const STATUS_VARIANT: Record<
  (typeof STATUSES)[number],
  React.ComponentProps<typeof Badge>["variant"]
> = {
  BOOKED: "info",
  WAITING: "warning",
  IN_PROGRESS: "default",
  COMPLETED: "success",
  SKIPPED: "muted",
  CANCELLED: "destructive",
  NO_SHOW: "muted",
};

export interface AppointmentDrawerProps {
  appointmentId: string | null;
  onClose: () => void;
}

type CommunicationRow = {
  id: string;
  kind: "communication" | "call" | "notification" | "visit" | "message";
  channel?: string;
  direction?: string;
  title: string;
  body?: string | null;
  at: string;
};

function usePatientTimeline(patientId: string | null) {
  return useQuery<CommunicationRow[], Error>({
    queryKey: ["appointment-drawer", "timeline", patientId],
    enabled: Boolean(patientId),
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients/${patientId}/communications?limit=15`,
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { items: CommunicationRow[] };
      return j.items ?? [];
    },
    staleTime: 30_000,
  });
}

export function AppointmentDrawer({
  appointmentId,
  onClose,
}: AppointmentDrawerProps) {
  const t = useTranslations("appointments.drawer");
  const tStatus = useTranslations("appointments.status");
  const tChannel = useTranslations("appointments.channel");
  const tPayment = useTranslations("appointments.payment");
  const locale = useLocale() as Locale;

  const open = Boolean(appointmentId);

  const query = useAppointment(appointmentId);

  const safeId = appointmentId ?? "__none";
  const patch = usePatchAppointment(safeId);
  const setQueueStatus = useSetQueueStatus(safeId);
  const del = useDeleteAppointment(safeId);

  const timeline = usePatientTimeline(query.data?.patient.id ?? null);

  const appt = query.data;

  const [notesLocal, setNotesLocal] = React.useState<string>("");
  const [notesDirty, setNotesDirty] = React.useState(false);

  React.useEffect(() => {
    if (appt) {
      setNotesLocal(appt.comments ?? "");
      setNotesDirty(false);
    }
  }, [appt?.id, appt?.comments]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = () => {
    if (!appt) return;
    patch.mutate(
      { comments: notesLocal },
      {
        onSuccess: () => {
          setNotesDirty(false);
          toast.success(t("notesSaved"));
        },
      },
    );
  };

  const onStatusChange = (next: (typeof STATUSES)[number]) => {
    if (!appt) return;
    setQueueStatus.mutate(next, {
      onError: () => toast.error(t("statusError")),
    });
  };

  const onChannelChange = (next: (typeof CHANNELS)[number]) => {
    if (!appt) return;
    patch.mutate(
      { channel: next },
      {
        onError: (err) => {
          if (!(err instanceof AppointmentConflictError)) {
            toast.error(err.message);
          }
        },
      },
    );
  };

  const onTimeChange = (nextTime: string) => {
    if (!appt) return;
    patch.mutate(
      { time: nextTime || null },
      {
        onError: (err) => {
          if (err instanceof AppointmentConflictError) {
            toast.error(
              (
                t as unknown as (
                  k: string,
                  v?: Record<string, string>,
                ) => string
              )(`conflict.${err.conflict.reason}`, {
                until: err.conflict.until ?? "",
              }),
            );
          } else {
            toast.error(err.message);
          }
        },
      },
    );
  };

  const onCancel = () => {
    if (!appt) return;
    if (!confirm(t("cancelConfirm"))) return;
    del.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("cancelled"));
        onClose();
      },
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-[540px]"
        showCloseButton={false}
      >
        <SheetHeader className="border-b bg-card/50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle>{t("title")}</SheetTitle>
              <SheetDescription>
                {appt
                  ? `${formatDate(appt.date, locale, "long")}, ${
                      appt.time ?? formatDate(appt.date, locale, "time")
                    }`
                  : t("loading")}
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t("close")}
            >
              <XIcon className="size-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {query.isLoading ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : query.isError || !appt ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
              {t("error")}
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              {/* Patient block */}
              <section className="rounded-lg border border-border bg-card/40 p-3">
                <div className="flex items-center gap-3">
                  <AvatarWithStatus
                    src={appt.patient.photoUrl ?? undefined}
                    name={appt.patient.fullName}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {appt.patient.fullName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <PhoneText phone={appt.patient.phone} asText />
                    </div>
                  </div>
                  <Link
                    href={`/${locale}/crm/patients/${appt.patient.id}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                    )}
                    aria-label={t("openPatient")}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    {t("openPatient")}
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <a
                    href={`tel:${appt.patient.phone.replace(/\s/g, "")}`}
                    className={cn(
                      buttonVariants({ variant: "outline", size: "sm" }),
                    )}
                  >
                    <PhoneIcon className="size-3.5" />
                    {t("call")}
                  </a>
                  <Badge variant="muted">
                    <UserIcon className="size-3" />
                    {appt.patient.segment}
                  </Badge>
                </div>
              </section>

              {/* Status + time */}
              <section className="grid gap-3 rounded-lg border border-border bg-card/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t("fields.status")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[appt.status]}>
                        {tStatus(appt.status.toLowerCase() as never)}
                      </Badge>
                    </div>
                  </div>
                  <Select
                    value={appt.status}
                    onValueChange={(v) =>
                      onStatusChange(v as (typeof STATUSES)[number])
                    }
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {nextStatuses(appt.status as AppointmentStatus).map(
                        (s) => (
                          <SelectItem key={s} value={s}>
                            {tStatus(s.toLowerCase() as never)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t("fields.time")}
                    </span>
                    <input
                      type="time"
                      value={appt.time ?? ""}
                      onBlur={(e) => {
                        if ((e.target.value || null) !== (appt.time || null)) {
                          onTimeChange(e.target.value);
                        }
                      }}
                      onChange={() => {
                        /* committed on blur */
                      }}
                      className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/40"
                    />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t("fields.duration")}
                    </span>
                    <div className="flex items-center gap-1 text-sm">
                      <ClockIcon className="size-3.5 text-muted-foreground" />
                      {appt.durationMin} {t("minutes")}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t("fields.doctor")}
                    </span>
                    <span className="text-sm">
                      {locale === "uz"
                        ? appt.doctor.nameUz
                        : appt.doctor.nameRu}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">
                      {t("fields.cabinet")}
                    </span>
                    <span className="text-sm">
                      {appt.cabinet ? `№${appt.cabinet.number}` : "—"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {t("fields.channel")}
                  </span>
                  <Select
                    value={appt.channel}
                    onValueChange={(v) =>
                      onChannelChange(v as (typeof CHANNELS)[number])
                    }
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {tChannel(c.toLowerCase() as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              {/* Services */}
              <section className="rounded-lg border border-border bg-card/40 p-3">
                <h4 className="mb-2 text-sm font-medium text-foreground">
                  {t("fields.services")}
                </h4>
                {appt.services.length === 0 && !appt.primaryService ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noServices")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {appt.services.length > 0
                      ? appt.services.map((line) => (
                          <li
                            key={`${appt.id}-${line.serviceId}`}
                            className="flex items-center justify-between py-1.5"
                          >
                            <span className="text-sm">
                              {locale === "uz"
                                ? line.service.nameUz
                                : line.service.nameRu}
                              {line.quantity > 1 ? ` × ${line.quantity}` : null}
                            </span>
                            <MoneyText
                              amount={line.priceSnap * line.quantity}
                              currency="UZS"
                              className="text-sm text-muted-foreground"
                            />
                          </li>
                        ))
                      : appt.primaryService
                        ? (
                          <li className="flex items-center justify-between py-1.5">
                            <span className="text-sm">
                              {locale === "uz"
                                ? appt.primaryService.nameUz
                                : appt.primaryService.nameRu}
                            </span>
                          </li>
                        )
                        : null}
                  </ul>
                )}

                <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">
                    {t("fields.total")}
                  </span>
                  <MoneyText
                    amount={appt.priceFinal ?? 0}
                    currency="UZS"
                    className="text-sm font-medium"
                  />
                </div>
              </section>

              {/* Payments */}
              <section className="rounded-lg border border-border bg-card/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">
                    {t("fields.payments")}
                  </h4>
                  <Badge variant="muted">
                    {tPayment(paymentStatusFor(appt).toLowerCase() as never)}
                  </Badge>
                </div>
                {appt.payments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noPayments")}
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {appt.payments.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between py-1.5"
                      >
                        <span className="text-sm text-muted-foreground">
                          {p.method ?? "—"}
                        </span>
                        <div className="flex items-center gap-2">
                          <MoneyText
                            amount={p.amount}
                            currency="UZS"
                            className="text-sm"
                          />
                          <Badge
                            variant={
                              p.status === "PAID"
                                ? "success"
                                : p.status === "PARTIAL"
                                  ? "warning"
                                  : p.status === "REFUNDED"
                                    ? "muted"
                                    : "destructive"
                            }
                          >
                            {tPayment(
                              (p.status === "UNPAID"
                                ? "unpaid"
                                : p.status.toLowerCase()) as never,
                            )}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Notes */}
              <section className="rounded-lg border border-border bg-card/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-foreground">
                    {t("fields.notes")}
                  </h4>
                  {notesDirty ? (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setNotesLocal(appt.comments ?? "");
                          setNotesDirty(false);
                        }}
                      >
                        {t("notesReset")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={saveNotes}
                        disabled={patch.isPending}
                      >
                        {patch.isPending ? t("saving") : t("notesSave")}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <Textarea
                  value={notesLocal}
                  onChange={(e) => {
                    setNotesLocal(e.target.value);
                    setNotesDirty(e.target.value !== (appt.comments ?? ""));
                  }}
                  placeholder={t("notesPlaceholder")}
                  rows={3}
                />
              </section>

              {/* Timeline */}
              <section className="rounded-lg border border-border bg-card/40 p-3">
                <h4 className="mb-2 text-sm font-medium text-foreground">
                  {t("fields.history")}
                </h4>
                {timeline.isLoading ? (
                  <p className="text-xs text-muted-foreground">
                    {t("loading")}
                  </p>
                ) : (timeline.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noHistory")}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {(timeline.data ?? []).slice(0, 8).map((row) => (
                      <li
                        key={row.id}
                        className="flex items-start gap-2 text-xs"
                      >
                        <span className="w-24 shrink-0 text-muted-foreground">
                          {formatDate(row.at, locale, "relative")}
                        </span>
                        <span className="min-w-0 flex-1 text-foreground">
                          {row.title}
                          {row.body ? (
                            <span className="ml-1 text-muted-foreground">
                              · {row.body}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  disabled={
                    del.isPending ||
                    !actionsFor(appt.status as AppointmentStatus).canCancel
                  }
                  className="text-destructive"
                >
                  {t("cancelAppt")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
