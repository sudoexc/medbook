"use client";

/**
 * <SoapDraftCard /> — Phase 15 Wave 5.
 *
 * Renders the AI-generated SOAP draft attached to a MedicalCase. Doctors
 * can edit the markdown directly and save back to the case via PATCH.
 *
 * The draft is created by the `voice-soap` worker after a doctor sends a
 * voice message to the clinic's TG bot. When the worker finishes it
 * publishes a `case.soap-draft.refreshed` SSE event for this caseId; we
 * subscribe via `useLiveQueryInvalidation` and refetch the case so the new
 * draft appears without a manual reload.
 *
 * The doctor must press Save explicitly — the worker's value lives only in
 * the cache until then. This keeps the AI in advisory mode (per the
 * Wave 5 spec): the doctor remains the source of truth.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { SparklesIcon, PencilIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useLiveQueryInvalidation } from "@/hooks/use-live-query";

import {
  type CaseDetail,
  caseKey,
  usePatchCase,
} from "../_hooks/use-case";

export type SoapDraftCardProps = {
  caseId: string;
  initialDraft: string | null;
};

export function SoapDraftCard({ caseId, initialDraft }: SoapDraftCardProps) {
  const t = useTranslations("soapDraft");
  const qc = useQueryClient();
  const patch = usePatchCase(caseId);

  // We keep two pieces of state: the read-mode "current" value (what the
  // server says is on the case right now) and an "editing" copy that lives
  // only inside the textarea. The current value is sourced from props
  // (parent passes `data.soapDraft`) so live SSE refetches flow through
  // automatically.
  const current = initialDraft ?? "";
  const [editing, setEditing] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  // When a worker run finishes for THIS case we want the parent to refetch
  // and the user to see the new draft pop in. If the user is mid-edit we
  // still let them finish — we just briefly show "refreshing" to hint that
  // the underlying value moved.
  useLiveQueryInvalidation({
    events: ["case.soap-draft.refreshed"],
    queryKey: caseKey(caseId) as unknown as readonly unknown[],
    shouldInvalidate: (event) => {
      if (event.type !== "case.soap-draft.refreshed") return false;
      const ok = event.payload.caseId === caseId;
      if (ok) {
        setRefreshing(true);
        // Clear the spinner shortly after the cache update lands.
        window.setTimeout(() => setRefreshing(false), 1500);
      }
      return ok;
    },
    enabled: true,
  });

  const onEdit = React.useCallback(() => {
    setEditing(current);
  }, [current]);

  const onCancel = React.useCallback(() => {
    setEditing(null);
  }, []);

  const onSave = React.useCallback(async () => {
    if (editing === null) return;
    const next = editing.trim();
    try {
      await patch.mutateAsync({
        soapDraft: next.length === 0 ? null : next,
      } as never);
      toast.success(t("save"));
      setEditing(null);
      qc.invalidateQueries({ queryKey: caseKey(caseId) });
    } catch (err) {
      toast.error((err as Error)?.message ?? t("save"));
    }
  }, [caseId, editing, patch, qc, t]);

  const isEditing = editing !== null;
  const empty = !isEditing && current.trim().length === 0;

  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SparklesIcon
            className={cn(
              "size-4 text-primary",
              empty && "text-muted-foreground/50",
            )}
            aria-hidden
          />
          <h3 className="text-sm font-medium text-foreground">{t("title")}</h3>
          <Badge variant="muted" className="gap-1">
            AI
          </Badge>
          {refreshing ? (
            <span className="text-xs text-muted-foreground">
              {t("refreshing")}
            </span>
          ) : null}
        </div>
        {!isEditing ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t("edit")}
          >
            <PencilIcon className="size-3.5" />
            {t("edit")}
          </Button>
        ) : null}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={editing ?? ""}
            onChange={(e) => setEditing(e.target.value)}
            rows={14}
            className="font-mono text-xs leading-relaxed"
            placeholder={t("empty")}
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={patch.isPending}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={patch.isPending}
            >
              {t("save")}
            </Button>
          </div>
        </div>
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
          {current}
        </pre>
      )}
    </section>
  );
}
