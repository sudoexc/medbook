"use client";

/**
 * Ф4 — shared bits for the knowledge settings tabs: line-list helpers,
 * origin badges and the catalog-overlay mutation (hide / override globals).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

import { settingsFetch } from "../../_hooks/use-settings-api";

export type OverlayEntityType = "DRUG" | "GUIDE" | "HANDOUT";

export function listToText(arr: readonly string[] | null | undefined): string {
  return (arr ?? []).join("\n");
}

export function textToList(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Origin flags every list row carries after the Ф4 read-route merge. */
export type RowFlags = {
  clinicId: string | null;
  clinicOverridden: boolean;
  hiddenByClinic: boolean;
};

export function RowBadges({ row }: { row: RowFlags }) {
  const t = useTranslations("settings.knowledge.badges");
  return (
    <span className="inline-flex items-center gap-1">
      {row.clinicId !== null ? (
        <Badge variant="info">{t("clinic")}</Badge>
      ) : null}
      {row.clinicOverridden ? (
        <Badge variant="warning">{t("overridden")}</Badge>
      ) : null}
      {row.hiddenByClinic ? <Badge variant="muted">{t("hidden")}</Badge> : null}
    </span>
  );
}

export type OverlayPayload = {
  entityType: OverlayEntityType;
  entityCode: string;
  hideGlobal?: boolean;
  /** `null` clears a stored override; omit to leave it untouched. */
  overrides?: Record<string, unknown> | null;
};

export function useOverlayMutation(
  invalidateKey: readonly unknown[],
  onDone?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OverlayPayload) =>
      settingsFetch("/api/crm/clinic-catalog-overlays", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invalidateKey });
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
