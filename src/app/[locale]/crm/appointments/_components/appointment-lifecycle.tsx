"use client";

/**
 * Phase 12 Wave 1 — Visual appointment lifecycle.
 *
 *   [BOOKED] → [WAITING] → [IN_PROGRESS] → [COMPLETED]
 *
 *   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
 *   │   NO_SHOW    │  │  CANCELLED   │  │   SKIPPED    │
 *   └──────────────┘  └──────────────┘  └──────────────┘
 *
 * The chain mirrors the state machine declared in
 * `src/lib/appointment-transitions.ts`. Allowed transitions are decided by
 * `src/lib/appointments/lifecycle.ts` so the same logic backs the reception
 * card's quick-action icons. Server-side gating is the authority — clicking
 * a disabled-looking pill simply won't render, and any 409 from the PATCH is
 * surfaced through the existing `useSetQueueStatus` mutation toast.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import {
  LIFECYCLE_OFFPATH,
  LIFECYCLE_STEPS,
  canMutateStatus,
  getAllowedTransitionsAt,
  getStepStates,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import type { AppointmentStatus } from "@/lib/appointment-transitions";

export interface AppointmentLifecycleProps {
  /** Current status of the appointment. Both `status` and `queueStatus`
   * share the same enum and stay in sync through the queue-status PATCH. */
  status: AppointmentStatus;
  /** Scheduled start (ISO string or Date). Used for the NO_SHOW time gate. */
  appointmentDate: string | Date;
  /** Role of the current user — drives which pills are clickable. */
  role: LifecycleRole;
  /** True when a status mutation is in-flight (drives spinner). */
  pending?: boolean;
  /** Called when the user picks a new status. Parent owns the mutation. */
  onChange: (next: AppointmentStatus) => void;
}

type OffpathStyle = { boxClass: string; iconClass: string };
const OFFPATH_VARIANT: { [K in "NO_SHOW" | "CANCELLED" | "SKIPPED"]: OffpathStyle } = {
  NO_SHOW: {
    boxClass:
      "border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10",
    iconClass: "text-destructive",
  },
  CANCELLED: {
    boxClass:
      "border-border bg-muted/40 text-muted-foreground hover:bg-muted/60",
    iconClass: "text-muted-foreground",
  },
  SKIPPED: {
    // `--warning-foreground` is white (sized for solid `bg-warning`); on the
    // soft `bg-warning/10` tint it disappears. Use dark amber ink instead
    // (Tailwind amber-800, ~5.5:1 over the cream tint).
    boxClass:
      "border-warning/40 bg-warning/10 text-amber-800 dark:text-amber-200 hover:bg-warning/15",
    iconClass: "text-warning",
  },
};

export function AppointmentLifecycle({
  status,
  appointmentDate,
  role,
  pending = false,
  onChange,
}: AppointmentLifecycleProps) {
  const t = useTranslations("appointmentLifecycle");
  const tStatus = useTranslations("appointments.status");

  const apptDate = React.useMemo(
    () =>
      appointmentDate instanceof Date
        ? appointmentDate
        : new Date(appointmentDate),
    [appointmentDate],
  );

  const stepStates = getStepStates(status);
  const canMutate = canMutateStatus(role);
  const allowed = React.useMemo(
    () =>
      new Set(getAllowedTransitionsAt(status, role, apptDate)),
    [status, role, apptDate],
  );

  // Confirmation dialog — used for off-path destinations (NO_SHOW / CANCELLED
  // / SKIPPED) to prevent fat-finger clicks. Forward steps in the chain are
  // intentionally one-click.
  const [confirmTarget, setConfirmTarget] = React.useState<
    AppointmentStatus | null
  >(null);

  const handleStepClick = (target: AppointmentStatus) => {
    if (pending) return;
    if (target === status) return;
    if (!allowed.has(target)) return;
    onChange(target);
  };

  const handleOffpathClick = (target: AppointmentStatus) => {
    if (pending) return;
    if (target === status) return;
    if (!allowed.has(target)) {
      // Specific guidance for the most common gate — NO_SHOW before the slot.
      if (target === "NO_SHOW") {
        toast.error(t("noShowTooEarly"));
      }
      return;
    }
    setConfirmTarget(target);
  };

  return (
    <section
      className="rounded-lg border border-border bg-card/40 p-3"
      aria-label={t("ariaLabel")}
    >
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{t("title")}</h4>
        {pending ? (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Loader2Icon className="size-3.5 animate-spin" />
            {t("saving")}
          </span>
        ) : null}
      </div>

      {/* Happy-path chain */}
      <ol
        className="flex items-center gap-1.5 overflow-x-auto pb-1"
        role="list"
      >
        {LIFECYCLE_STEPS.map((step, i) => {
          const state = stepStates[step];
          const isClickable =
            canMutate && !pending && step !== status && allowed.has(step);
          const isCurrent = state === "current";
          const isPassed = state === "passed";
          const isUnreachable = state === "unreachable";

          return (
            <React.Fragment key={step}>
              <li className="shrink-0">
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => handleStepClick(step)}
                  aria-current={isCurrent ? "step" : undefined}
                  aria-label={tStatus(step.toLowerCase() as never)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    isCurrent &&
                      !isUnreachable &&
                      "border-primary bg-primary text-primary-foreground",
                    isPassed &&
                      "border-success/50 bg-success/15 text-[color:var(--success)]",
                    state === "future" &&
                      !isUnreachable &&
                      "border-dashed border-border bg-background text-muted-foreground",
                    isUnreachable &&
                      "border-dashed border-border/60 bg-background/50 text-muted-foreground/60",
                    isClickable
                      ? "cursor-pointer hover:brightness-95"
                      : "cursor-not-allowed",
                  )}
                >
                  {isPassed || isCurrent ? (
                    <CheckIcon className="size-3" />
                  ) : (
                    <span
                      className="inline-flex size-3 items-center justify-center text-[10px] font-bold tabular-nums"
                      aria-hidden
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className="whitespace-nowrap">
                    {tStatus(step.toLowerCase() as never)}
                  </span>
                </button>
              </li>
              {i < LIFECYCLE_STEPS.length - 1 ? (
                <li
                  className={cn(
                    "h-px w-3 shrink-0 sm:w-4",
                    stepStates[LIFECYCLE_STEPS[i + 1]] === "passed" ||
                      stepStates[LIFECYCLE_STEPS[i + 1]] === "current"
                      ? "bg-success/50"
                      : "bg-border",
                  )}
                  aria-hidden
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </ol>

      {/* Off-path boxes */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        {LIFECYCLE_OFFPATH.map((off) => {
          const variant = OFFPATH_VARIANT[off];
          const isCurrent = status === off;
          const isClickable =
            canMutate && !pending && !isCurrent && allowed.has(off);
          return (
            <button
              key={off}
              type="button"
              disabled={!canMutate || pending || isCurrent}
              onClick={() => handleOffpathClick(off)}
              aria-pressed={isCurrent}
              aria-label={t(`offpath.${off}`)}
              className={cn(
                "inline-flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-2 text-[11px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                variant.boxClass,
                isCurrent && "ring-2 ring-offset-1 ring-current",
                isClickable
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-60",
              )}
            >
              <XIcon className={cn("size-3.5", variant.iconClass)} aria-hidden />
              <span className="leading-none">{t(`offpath.${off}`)}</span>
            </button>
          );
        })}
      </div>

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(v) => {
          if (!v) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmTarget ? t(`confirm.${confirmTarget}.title`) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget ? t(`confirm.${confirmTarget}.description`) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{t("confirm.cancel")}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                onClick={() => {
                  if (confirmTarget) onChange(confirmTarget);
                  setConfirmTarget(null);
                }}
              >
                {t("confirm.proceed")}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
