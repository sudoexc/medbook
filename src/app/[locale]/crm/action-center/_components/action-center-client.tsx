"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { LayoutListIcon, RefreshCcwIcon, ZapIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/atoms/empty-state";
import { toast } from "@/components/ui/sonner";
import {
  ACTION_SEVERITIES,
  ACTION_TYPES,
  SEVERITY_RANK,
  type ActionSeverity,
  type ActionStatus,
  type ActionType,
} from "@/lib/actions/types";
import { SEVERITY_DOT_CLASS } from "@/lib/actions/icons";

import {
  useActionsPaged,
  useRecomputeActions,
  type ActionRow,
} from "../_hooks/use-actions";
import { ActionCard } from "./action-card";

type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR"
  | null;

const TABS: ActionStatus[] = ["OPEN", "SNOOZED", "DISMISSED", "DONE"];

const TYPE_OPTIONS: ReadonlyArray<ActionType> = ACTION_TYPES;

export interface ActionCenterClientProps {
  /** Server-resolved role; ADMIN gates the recompute + reopen + assignee filter. */
  role: Role;
}

/**
 * Top-level client for `/crm/action-center`. Holds tab + filter state and
 * renders one card per row. Pagination is cursor-based via the `useActionsPaged`
 * hook; live invalidation is wired inside that hook so any SSE
 * `action.created` / `action.updated` event triggers a refetch within ~400ms.
 */
export function ActionCenterClient({ role }: ActionCenterClientProps) {
  const t = useTranslations("actionCenter");
  const locale = useLocale();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";

  const [tab, setTab] = React.useState<ActionStatus>("OPEN");
  const [typeFilter, setTypeFilter] = React.useState<ActionType[]>([]);
  const [severityFilter, setSeverityFilter] = React.useState<ActionSeverity[]>([]);
  const [assigneeRoleFilter, setAssigneeRoleFilter] = React.useState<
    "ADMIN" | "RECEPTIONIST" | null
  >(null);

  const filters = React.useMemo(
    () => ({
      status: [tab],
      type: typeFilter.length > 0 ? typeFilter : undefined,
      severity: severityFilter.length > 0 ? severityFilter : undefined,
      assigneeRole: isAdmin ? assigneeRoleFilter ?? undefined : undefined,
      limit: 50,
    }),
    [tab, typeFilter, severityFilter, assigneeRoleFilter, isAdmin],
  );

  const { rows, isLoading, error, hasMore, loadMore, isFetching } = useActionsPaged(
    filters,
  );

  const recompute = useRecomputeActions();

  const fireRecompute = async () => {
    try {
      const r = await recompute.mutateAsync();
      toast.success(
        t("recomputeSuccess", { created: r.created, updated: r.updated }),
      );
    } catch (e) {
      toast.error(
        t("recomputeError", {
          reason: e instanceof Error ? e.message : "Error",
        }),
      );
    }
  };

  const localePath = React.useCallback(
    (path: string) => {
      // The detector deeplinks all start with `/crm/...`. We prefix the active
      // locale so navigation stays inside the right next-intl tree.
      if (!path.startsWith("/")) return path;
      return `/${locale}${path}`;
    },
    [locale],
  );

  const grouped = React.useMemo(() => groupBySeverity(rows), [rows]);

  return (
    <div className="flex flex-col gap-5 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-foreground">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ZapIcon className="size-4" />
            </span>
            {t("title")}
            {tab === "OPEN" && rows.length > 0 ? (
              <Badge variant="destructive" className="text-[11px]">
                {rows.length}
              </Badge>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {isAdmin ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void fireRecompute()}
            disabled={recompute.isPending}
          >
            <RefreshCcwIcon
              className={cn(
                "size-3.5",
                recompute.isPending && "animate-spin",
              )}
            />
            {t("recomputeNow")}
          </Button>
        ) : null}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ActionStatus)}>
        <TabsList>
          {TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`tabs.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Severity chips — multi-toggle. */}
          <div className="flex items-center gap-1.5">
            {ACTION_SEVERITIES.slice()
              .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])
              .map((sv) => {
                const active = severityFilter.includes(sv);
                return (
                  <button
                    key={sv}
                    type="button"
                    onClick={() =>
                      setSeverityFilter((cur) =>
                        cur.includes(sv)
                          ? cur.filter((x) => x !== sv)
                          : [...cur, sv],
                      )
                    }
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-1.5 rounded-full", SEVERITY_DOT_CLASS[sv])}
                    />
                    {t(`severity.${sv}`)}
                  </button>
                );
              })}
          </div>

          {/* Type filter — single select for now (multi adds noise on a small list). */}
          <Select
            value={typeFilter[0] ?? "ALL"}
            onValueChange={(v) =>
              setTypeFilter(v === "ALL" ? [] : [v as ActionType])
            }
          >
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue placeholder={t("filters.typeAll")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("filters.typeAll")}</SelectItem>
              {TYPE_OPTIONS.map((tp) => (
                <SelectItem key={tp} value={tp}>
                  {t(`types.${tp}.label`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isAdmin ? (
            <Select
              value={assigneeRoleFilter ?? "ALL"}
              onValueChange={(v) =>
                setAssigneeRoleFilter(
                  v === "ALL" ? null : (v as "ADMIN" | "RECEPTIONIST"),
                )
              }
            >
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue placeholder={t("filters.assigneeAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("filters.assigneeAll")}</SelectItem>
                <SelectItem value="ADMIN">{t("filters.assigneeAdmin")}</SelectItem>
                <SelectItem value="RECEPTIONIST">
                  {t("filters.assigneeReceptionist")}
                </SelectItem>
              </SelectContent>
            </Select>
          ) : null}
        </div>

        {TABS.map((s) => (
          <TabsContent key={s} value={s} className="mt-4 space-y-5">
            {error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {error.message}
              </div>
            ) : null}

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-24 animate-pulse rounded-xl border border-border bg-card/40"
                  />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<LayoutListIcon />}
                title={t(`empty.${s}.title`)}
                description={t(`empty.${s}.description`)}
              />
            ) : (
              <RenderGrouped
                grouped={grouped}
                showReopen={isAdmin && (s === "DISMISSED" || s === "DONE")}
                localePath={localePath}
              />
            )}

            {!isLoading && rows.length > 0 && hasMore ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isFetching}
                >
                  {t("loadMore")}
                </Button>
              </div>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function groupBySeverity(rows: ActionRow[]): Record<ActionSeverity, ActionRow[]> {
  const out: Record<ActionSeverity, ActionRow[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };
  for (const r of rows) out[r.severity].push(r);
  return out;
}

function RenderGrouped({
  grouped,
  showReopen,
  localePath,
}: {
  grouped: Record<ActionSeverity, ActionRow[]>;
  showReopen: boolean;
  localePath: (path: string) => string;
}) {
  const t = useTranslations("actionCenter");
  // Render in severity order (critical first).
  const order: ActionSeverity[] = ["critical", "high", "medium", "low"];
  return (
    <>
      {order.map((sv) => {
        const rows = grouped[sv];
        if (rows.length === 0) return null;
        return (
          <section key={sv} aria-label={t(`severity.${sv}`)}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", SEVERITY_DOT_CLASS[sv])}
              />
              {t(`severity.${sv}`)}
              <span className="tabular-nums text-muted-foreground/70">
                ({rows.length})
              </span>
            </div>
            <div className="space-y-2">
              {rows.map((row) => (
                <ActionCard
                  key={row.id}
                  row={row}
                  variant="full"
                  showReopen={showReopen}
                  localePath={localePath}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
