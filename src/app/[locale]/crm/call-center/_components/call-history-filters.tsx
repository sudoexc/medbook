"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { HistoryFilters } from "../_hooks/use-call-history";

type OperatorHit = { id: string; name: string | null };

/**
 * Date range + operator + direction + search for the history column.
 *
 * Debounces the text search by 300ms so we don't fire a query on every keystroke.
 */
export function CallHistoryFilters({
  filters,
  setFilters,
  onReset,
}: {
  filters: HistoryFilters;
  setFilters: (patch: Partial<HistoryFilters>) => void;
  onReset: () => void;
}) {
  const t = useTranslations("callCenter.history.filters");

  const [q, setQ] = React.useState(filters.q);
  React.useEffect(() => setQ(filters.q), [filters.q]);
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      if (q !== filters.q) setFilters({ q });
    }, 300);
    return () => window.clearTimeout(id);
  }, [q, filters.q, setFilters]);

  const operatorsQuery = useQuery<OperatorHit[], Error>({
    queryKey: ["call-center", "operators"],
    queryFn: async () => {
      // Staff list endpoint isn't in scope for Phase 3c; reuse the users
      // endpoint if it exists, otherwise gracefully fall back to empty.
      const res = await fetch(`/api/crm/users?role=CALL_OPERATOR&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) return [];
      const j = (await res.json()) as { rows: OperatorHit[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });

  const hasActive =
    filters.status !== "all" ||
    filters.direction !== "all" ||
    filters.operatorId !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.q !== "";

  return (
    <div className="grid gap-2 border-b border-border p-3">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="pl-8"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("status")}
          </Label>
          <Select
            value={filters.status}
            onValueChange={(v) => setFilters({ status: v as HistoryFilters["status"] })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("statusAll")}</SelectItem>
              <SelectItem value="ringing">{t("statusRinging")}</SelectItem>
              <SelectItem value="answered">{t("statusAnswered")}</SelectItem>
              <SelectItem value="ended">{t("statusEnded")}</SelectItem>
              <SelectItem value="missed">{t("statusMissed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("direction")}
          </Label>
          <Select
            value={filters.direction}
            onValueChange={(v) => setFilters({ direction: v as HistoryFilters["direction"] })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("directionAll")}</SelectItem>
              <SelectItem value="IN">{t("directionIn")}</SelectItem>
              <SelectItem value="OUT">{t("directionOut")}</SelectItem>
              <SelectItem value="MISSED">{t("directionMissed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1">
        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t("operator")}
        </Label>
        <Select
          value={filters.operatorId || "__all"}
          onValueChange={(v) => setFilters({ operatorId: v === "__all" ? "" : v })}
        >
          <SelectTrigger className="h-8">
            <SelectValue placeholder={t("operatorAll")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("operatorAll")}</SelectItem>
            {(operatorsQuery.data ?? []).map((op) => (
              <SelectItem key={op.id} value={op.id}>
                {op.name ?? op.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("from")}
          </Label>
          <Input
            type="date"
            value={isoToDate(filters.from)}
            onChange={(e) =>
              setFilters({ from: e.target.value ? new Date(e.target.value).toISOString() : "" })
            }
            className="h-8"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("to")}
          </Label>
          <Input
            type="date"
            value={isoToDate(filters.to)}
            onChange={(e) =>
              setFilters({ to: e.target.value ? new Date(e.target.value).toISOString() : "" })
            }
            className="h-8"
          />
        </div>
      </div>

      {hasActive ? (
        <Button type="button" variant="ghost" size="sm" onClick={onReset}>
          <XIcon className="size-3" />
          {t("reset")}
        </Button>
      ) : null}
    </div>
  );
}

function isoToDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
