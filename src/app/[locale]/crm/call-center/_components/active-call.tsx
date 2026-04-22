"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  CalendarPlusIcon,
  ExternalLinkIcon,
  PhoneMissedIcon,
  PhoneOffIcon,
  UserPlusIcon,
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import type { CallRow } from "../_hooks/types";
import { deriveStatus } from "../_hooks/types";
import { useCallNotes, useCallPatch } from "../_hooks/use-call-notes";

/**
 * Center column — active call.
 *
 * Everything the operator needs while a call is in-flight:
 *   - patient badge (linked or anonymous)
 *   - live-incrementing timer since createdAt
 *   - debounced notes textarea (PATCH on blur)
 *   - quick actions: Записать / Создать карточку / Завершить / Пропущен
 *
 * When no call is selected, shows an empty state. Dialing and SIP controls
 * (mute/hold/transfer) are intentionally absent — per §6.7.5 they only light
 * up once a real adapter replaces LogOnly.
 */
export function ActiveCall({ call }: { call: CallRow | null }) {
  const t = useTranslations("callCenter.active");
  const tStatus = useTranslations("callCenter.status");

  const notes = useCallNotes(call);
  const patch = useCallPatch();

  const [dialogOpen, setDialogOpen] = React.useState(false);

  if (!call) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-2">
          <h2 className="text-base font-semibold">{t("empty.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("empty.description")}</p>
        </div>
      </div>
    );
  }

  const status = deriveStatus(call);
  const phone = call.direction === "OUT" ? call.toNumber : call.fromNumber;

  const onHangup = async () => {
    try {
      await patch.mutateAsync({
        id: call.id,
        patch: { endedAt: new Date().toISOString() },
      });
      toast.success(t("actions.hangupDone"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onMarkMissed = async () => {
    try {
      await patch.mutateAsync({
        id: call.id,
        patch: {
          endedAt: new Date().toISOString(),
          // A `direction: "MISSED"` column update isn't allowed via the update
          // schema — tag it so history filters pick it up.
          tags: Array.from(new Set([...call.tags, "missed"])),
        },
      });
      toast.success(t("actions.markedMissed"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
      {/* ── Header: patient / caller + status ─────────────────────────── */}
      <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
            <span>{t(call.direction === "OUT" ? "direction.out" : "direction.in")}</span>
            <span aria-hidden>·</span>
            <StatusPill status={status} label={tStatus(status)} />
          </div>
          <h2 className="truncate text-xl font-semibold">
            {call.patient?.fullName ?? t("anonymous")}
          </h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="tabular-nums">{phone}</span>
            <LiveTimer startedAt={call.createdAt} endedAt={call.endedAt} />
          </div>
          {call.patient ? (
            <Link
              href={`/crm/patients/${call.patient.id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {t("openPatient")}
              <ExternalLinkIcon className="size-3" />
            </Link>
          ) : null}
        </div>
      </header>

      {/* ── Quick actions ──────────────────────────────────────────────── */}
      <section aria-label={t("actions.ariaLabel")} className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={() => setDialogOpen(true)}
            disabled={patch.isPending}
          >
            <CalendarPlusIcon className="size-4" />
            {t("actions.book")}
          </Button>

          {!call.patient ? (
            <Link
              href={`/crm/patients?new=true&phone=${encodeURIComponent(phone)}`}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              <UserPlusIcon className="size-4" />
              {t("actions.createPatient")}
            </Link>
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={onMarkMissed}
            disabled={patch.isPending || status === "ended" || status === "missed"}
          >
            <PhoneMissedIcon className="size-4" />
            {t("actions.markMissed")}
          </Button>

          <Button
            type="button"
            variant="destructive"
            onClick={onHangup}
            disabled={patch.isPending || status === "ended" || status === "missed"}
          >
            <PhoneOffIcon className="size-4" />
            {t("actions.hangup")}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("actions.disclaimer")}
          {/* TODO(adapter): wire mute/hold/transfer once a real SIP adapter replaces LogOnly. */}
        </p>
      </section>

      {/* ── Notes ──────────────────────────────────────────────────────── */}
      <section aria-label={t("notes.ariaLabel")} className="mt-6">
        <Label htmlFor="call-notes" className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("notes.label")}
        </Label>
        <Textarea
          id="call-notes"
          value={notes.value}
          onChange={(e) => notes.setValue(e.target.value)}
          onBlur={notes.flush}
          rows={5}
          placeholder={t("notes.placeholder")}
          className="mt-1 resize-none"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          {notes.isSaving ? t("notes.saving") : t("notes.hint")}
        </p>
      </section>

      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={call.patient?.id ?? null}
        initialPatientPhone={call.patient ? null : phone}
      />
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const cls =
    status === "ringing"
      ? "bg-primary/15 text-primary"
      : status === "answered"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : status === "missed"
      ? "bg-destructive/15 text-destructive"
      : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>
      {label}
    </span>
  );
}

/** Live-ticking mm:ss since `startedAt`. Freezes at `endedAt` if given. */
function LiveTimer({ startedAt, endedAt }: { startedAt: string; endedAt: string | null }) {
  const start = React.useMemo(() => new Date(startedAt).getTime(), [startedAt]);
  const end = React.useMemo(
    () => (endedAt ? new Date(endedAt).getTime() : null),
    [endedAt],
  );
  const [now, setNow] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    if (end != null) {
      setNow(end);
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [end]);

  const refNow = end ?? now;
  const sec = Math.max(0, Math.round((refNow - start) / 1000));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return (
    <span className="font-mono text-sm tabular-nums">
      {mm.toString().padStart(2, "0")}:{ss.toString().padStart(2, "0")}
    </span>
  );
}
