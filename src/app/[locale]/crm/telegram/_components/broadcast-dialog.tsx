"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  SendIcon,
  Loader2Icon,
  ClockIcon,
  ZapIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  CalendarClockIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateText } from "@/components/atoms/date-text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useDebounced } from "@/hooks/use-debounced";
import { BroadcastAudience } from "./broadcast-audience";
import { BroadcastPreview } from "./broadcast-preview";
import {
  useBroadcastPreview,
  useSendBroadcast,
  useBroadcastProgress,
  isResolvableSegment,
  type BroadcastSegment,
} from "../_hooks/use-broadcast";

type Phase = "compose" | "confirm" | "result";

const PLACEHOLDERS = [
  "patient.firstName",
  "patient.name",
  "clinic.name",
  "clinic.phone",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function BroadcastDialog({
  open,
  onOpenChange,
  prefill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Repeat" payload — seeds the composer when the dialog opens. */
  prefill?: { segment: BroadcastSegment; body: string } | null;
}) {
  const t = useTranslations("tgInbox.broadcast");
  const [phase, setPhase] = React.useState<Phase>("compose");

  const [segment, setSegment] = React.useState<BroadcastSegment>({ kind: "all" });
  const [body, setBody] = React.useState("");
  const [scheduleMode, setScheduleMode] = React.useState<"now" | "later">("now");
  const [scheduleAt, setScheduleAt] = React.useState("");
  const bodyRef = React.useRef<HTMLTextAreaElement | null>(null);

  const [resultId, setResultId] = React.useState<string | null>(null);
  const [resultDeferredAt, setResultDeferredAt] = React.useState<string | null>(null);

  const debouncedSegment = useDebounced(segment, 300);
  const resolvable = isResolvableSegment(segment);
  const previewQuery = useBroadcastPreview(resolvable ? debouncedSegment : null);
  const sendMutation = useSendBroadcast();
  const progress = useBroadcastProgress(phase === "result" ? resultId : null);

  const previewData = resolvable ? previewQuery.data : undefined;
  const eligible = previewData?.eligible ?? 0;
  const minLocal = toLocalInput(new Date(Date.now() + 60_000));
  const scheduleValid =
    scheduleMode === "now" ||
    (scheduleAt.length > 0 && new Date(scheduleAt).getTime() > Date.now());

  const canSend =
    body.trim().length > 0 && resolvable && eligible > 0 && scheduleValid;

  const reset = React.useCallback(() => {
    setPhase("compose");
    setSegment({ kind: "all" });
    setBody("");
    setScheduleMode("now");
    setScheduleAt("");
    setResultId(null);
    setResultDeferredAt(null);
    sendMutation.reset();
  }, [sendMutation]);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) reset();
  };

  // Seed the composer from a "Repeat" action: when the dialog transitions to
  // open with a prefill payload, copy its audience + text into the form.
  const prevOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (open && !prevOpenRef.current && prefill) {
      setSegment(prefill.segment);
      setBody(prefill.body);
      setPhase("compose");
      setScheduleMode("now");
      setScheduleAt("");
      setResultId(null);
      setResultDeferredAt(null);
    }
    prevOpenRef.current = open;
  }, [open, prefill]);

  const insertPlaceholder = (key: string) => {
    const token = `{{${key}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const onConfirmSend = () => {
    const scheduledFor =
      scheduleMode === "later" && scheduleAt
        ? new Date(scheduleAt).toISOString()
        : null;
    sendMutation.mutate(
      { segment, body: body.trim(), scheduledFor },
      {
        onSuccess: (res) => {
          setResultId(res.campaignId);
          setResultDeferredAt(res.deferred ? res.scheduledFor : null);
          setPhase("result");
          toast.success(res.deferred ? t("toast.scheduled") : t("toast.sent"));
        },
        onError: () => toast.error(t("toast.error")),
      },
    );
  };

  // ── Derived progress numbers (result phase) ────────────────────────────────
  const sbs = progress.data?.sendsByStatus ?? {};
  const sent = (sbs.SENT ?? 0) + (sbs.DELIVERED ?? 0) + (sbs.READ ?? 0);
  const failed = sbs.FAILED ?? 0;
  const pending = sbs.QUEUED ?? 0;
  const total = progress.data?.campaign.totalCount ?? sent + failed + pending;
  const done = total > 0 && pending === 0;
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SendIcon className="size-4 text-primary" aria-hidden />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        {phase === "compose" ? (
          <div className="grid gap-5 md:grid-cols-2">
            {/* LEFT — composer */}
            <div className="flex min-h-0 flex-col gap-4">
              <BroadcastAudience segment={segment} onChange={setSegment} />

              <div className="space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("message.label")}
                </div>
                <textarea
                  ref={bodyRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={6}
                  maxLength={4096}
                  placeholder={t("message.placeholder")}
                  className="flex min-h-[72px] w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-[13px] shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  {PLACEHOLDERS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertPlaceholder(key)}
                      className="rounded-md border border-border/70 bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                    >
                      {`{{${key}}}`}
                    </button>
                  ))}
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    {body.length}/4096
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("schedule.label")}
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1">
                  <button
                    type="button"
                    onClick={() => setScheduleMode("now")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                      scheduleMode === "now"
                        ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ZapIcon className="size-3.5" aria-hidden />
                    {t("schedule.now")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode("later")}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                      scheduleMode === "later"
                        ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ClockIcon className="size-3.5" aria-hidden />
                    {t("schedule.later")}
                  </button>
                </div>
                {scheduleMode === "later" ? (
                  <Input
                    type="datetime-local"
                    value={scheduleAt}
                    min={minLocal}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="h-9"
                  />
                ) : null}
              </div>
            </div>

            {/* RIGHT — live preview */}
            <BroadcastPreview
              body={body}
              preview={previewData}
              isLoading={previewQuery.isFetching}
              resolvable={resolvable}
            />
          </div>
        ) : null}

        {phase === "confirm" ? (
          <div className="space-y-3 py-1">
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {t("confirm.recipients")}
                </span>
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {eligible}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
                {scheduleMode === "later" && scheduleAt ? (
                  <>
                    <CalendarClockIcon className="size-4" aria-hidden />
                    <DateText
                      date={new Date(scheduleAt).toISOString()}
                      style="dayMonthTime"
                    />
                  </>
                ) : (
                  <>
                    <ZapIcon className="size-4" aria-hidden />
                    {t("confirm.immediate")}
                  </>
                )}
              </div>
            </div>
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[13px] text-[color:var(--warning-foreground)]">
              {t("confirm.warning", { count: eligible })}
            </p>
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[13px] text-foreground">
              {body.trim()}
            </div>
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="space-y-4 py-2">
            {resultDeferredAt ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <CalendarClockIcon className="size-10 text-primary" aria-hidden />
                <div className="text-base font-semibold text-foreground">
                  {t("result.scheduledTitle")}
                </div>
                <div className="text-[13px] text-muted-foreground">
                  {t("result.scheduledFor")}{" "}
                  <DateText date={resultDeferredAt} style="dayMonthTime" />
                </div>
                <div className="text-[13px] text-muted-foreground">
                  {t("result.recipients", { count: total })}
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {done ? (
                      <CheckCircle2Icon className="size-5 text-success" aria-hidden />
                    ) : (
                      <Loader2Icon className="size-5 animate-spin text-primary" aria-hidden />
                    )}
                    {done ? t("result.doneTitle") : t("result.sendingTitle")}
                  </span>
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    {sent + failed}/{total}
                  </span>
                </div>

                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-success/30 bg-success/5 py-2">
                    <div className="text-lg font-semibold tabular-nums text-[color:var(--success)]">
                      {sent}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("result.sent")}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/30 py-2">
                    <div className="text-lg font-semibold tabular-nums text-foreground">
                      {pending}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("result.pending")}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "rounded-lg border py-2",
                      failed > 0
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border/60 bg-muted/30",
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-center gap-1 text-lg font-semibold tabular-nums",
                        failed > 0 ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {failed > 0 ? (
                        <AlertTriangleIcon className="size-4" aria-hidden />
                      ) : null}
                      {failed}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {t("result.failed")}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {phase === "compose" ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button disabled={!canSend} onClick={() => setPhase("confirm")}>
                <SendIcon aria-hidden />
                {scheduleMode === "later"
                  ? t("scheduleCta", { count: eligible })
                  : t("sendCta", { count: eligible })}
              </Button>
            </>
          ) : null}

          {phase === "confirm" ? (
            <>
              <Button
                variant="outline"
                onClick={() => setPhase("compose")}
                disabled={sendMutation.isPending}
              >
                {t("back")}
              </Button>
              <Button onClick={onConfirmSend} disabled={sendMutation.isPending}>
                {sendMutation.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" aria-hidden />
                ) : (
                  <SendIcon aria-hidden />
                )}
                {scheduleMode === "later" ? t("confirm.schedule") : t("confirm.send")}
              </Button>
            </>
          ) : null}

          {phase === "result" ? (
            <Button onClick={() => handleOpenChange(false)}>{t("done")}</Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
