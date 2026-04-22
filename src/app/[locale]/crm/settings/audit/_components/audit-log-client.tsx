"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollIcon } from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { settingsFetch } from "../../_hooks/use-settings-api";

type AuditRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorId: string | null;
  actorRole: string | null;
  actorLabel: string | null;
  actor: { id: string; name: string; email: string; role: string } | null;
  ip: string | null;
  meta: unknown;
  createdAt: string;
};

type AuditPage = {
  rows: AuditRow[];
  nextCursor: string | null;
};

export function AuditLogClient() {
  const t = useTranslations("settings");

  const [filters, setFilters] = React.useState({
    entityType: "",
    action: "",
    actorId: "",
    from: "",
    to: "",
  });
  // Debounce filter inputs lightly.
  const [appliedFilters, setAppliedFilters] = React.useState(filters);
  React.useEffect(() => {
    const timer = setTimeout(() => setAppliedFilters(filters), 350);
    return () => clearTimeout(timer);
  }, [filters]);

  const query = useInfiniteQuery<AuditPage, Error>({
    queryKey: ["settings", "audit", appliedFilters],
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (appliedFilters.entityType)
        sp.set("entityType", appliedFilters.entityType);
      if (appliedFilters.action) sp.set("action", appliedFilters.action);
      if (appliedFilters.actorId) sp.set("actorId", appliedFilters.actorId);
      if (appliedFilters.from) sp.set("from", appliedFilters.from);
      if (appliedFilters.to) sp.set("to", appliedFilters.to);
      sp.set("limit", "100");
      if (pageParam) sp.set("cursor", String(pageParam));
      return settingsFetch<AuditPage>(`/api/crm/audit?${sp.toString()}`);
    },
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  // Auto-load when scrolled near bottom.
  React.useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      if (
        el.scrollTop + el.clientHeight >= el.scrollHeight - 200 &&
        query.hasNextPage &&
        !query.isFetchingNextPage
      ) {
        query.fetchNextPage();
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [query]);

  return (
    <PageContainer>
      <SectionHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
      />

      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-5">
        <div>
          <Label htmlFor="a-entity">{t("audit.filters.entity")}</Label>
          <Input
            id="a-entity"
            placeholder="Patient, Appointment..."
            value={filters.entityType}
            onChange={(e) =>
              setFilters({ ...filters, entityType: e.target.value })
            }
          />
        </div>
        <div>
          <Label htmlFor="a-action">{t("audit.filters.action")}</Label>
          <Input
            id="a-action"
            placeholder="user.update"
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="a-actor">{t("audit.filters.actor")}</Label>
          <Input
            id="a-actor"
            placeholder="userId"
            value={filters.actorId}
            onChange={(e) =>
              setFilters({ ...filters, actorId: e.target.value })
            }
          />
        </div>
        <div>
          <Label htmlFor="a-from">{t("audit.filters.from")}</Label>
          <Input
            id="a-from"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="a-to">{t("audit.filters.to")}</Label>
          <Input
            id="a-to"
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </div>
      </div>

      <div
        ref={parentRef}
        className="h-[65vh] overflow-auto rounded-lg border border-border bg-card"
      >
        {query.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
            <ScrollIcon className="size-5" />
            {t("audit.empty")}
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              if (!row) return null;
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                  className="border-b border-border px-3 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-primary">
                          {row.action}
                        </span>
                        {row.entityType ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                            {row.entityType}
                            {row.entityId ? `#${row.entityId.slice(-6)}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {row.actor
                          ? `${row.actor.name} (${row.actor.email})`
                          : (row.actorLabel ?? "system")}{" "}
                        · {row.actorRole ?? "—"}
                        {row.ip ? ` · ${row.ip}` : ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {row.meta ? (
                    <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted/40 p-2 text-[11px] leading-tight text-muted-foreground">
                      {JSON.stringify(row.meta, null, 2).slice(0, 1000)}
                    </pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage
              ? t("common.loading")
              : t("audit.loadMore")}
          </Button>
        </div>
      ) : null}
    </PageContainer>
  );
}
