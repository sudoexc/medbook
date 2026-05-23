"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollIcon } from "lucide-react";

import { intlLocale } from "@/lib/format";

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

type PatientViewRow = {
  id: string;
  clinicId: string;
  viewerUserId: string;
  viewerRole: string;
  patientId: string;
  context: string;
  contextRef: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  viewer: { id: string; name: string; email: string; role: string } | null;
  patient: { id: string; fullName: string; phone: string | null } | null;
};

type PatientViewsPage = {
  rows: PatientViewRow[];
  nextCursor: string | null;
};

type Tab = "events" | "patientViews";

/**
 * URL-state for the audit log. All filters + the active tab are reflected in
 * the URL so a refresh (or a link shared with another admin) restores the
 * exact view that was on screen. Filter keys are namespaced per tab
 * (`e_*` for events, `pv_*` for patient views) to avoid coupling — switching
 * tabs doesn't smear over the other tab's filters, and a URL with both sets
 * survives navigation.
 */
const EVENTS_KEYS = ["entityType", "action", "actorId", "from", "to"] as const;
const PV_KEYS = ["patientId", "viewerUserId", "context", "from", "to"] as const;

type EventsFilters = { entityType: string; action: string; actorId: string; from: string; to: string };
type PVFilters = { patientId: string; viewerUserId: string; context: string; from: string; to: string };

function emptyEventsFilters(): EventsFilters {
  return { entityType: "", action: "", actorId: "", from: "", to: "" };
}
function emptyPVFilters(): PVFilters {
  return { patientId: "", viewerUserId: "", context: "", from: "", to: "" };
}

function readEventsFilters(sp: URLSearchParams): EventsFilters {
  const out = emptyEventsFilters();
  for (const k of EVENTS_KEYS) {
    const v = sp.get(`e_${k}`);
    if (v) out[k] = v;
  }
  return out;
}

function readPVFilters(sp: URLSearchParams): PVFilters {
  const out = emptyPVFilters();
  for (const k of PV_KEYS) {
    const v = sp.get(`pv_${k}`);
    if (v) out[k] = v;
  }
  return out;
}

function readTab(sp: URLSearchParams): Tab {
  return sp.get("tab") === "patientViews" ? "patientViews" : "events";
}

/**
 * Coalesces consecutive URL writes from typing in filter inputs — the
 * `router.replace` itself is cheap, but each call also recomputes
 * `useSearchParams()` for every consumer on the page, and we want one
 * settled URL change per "burst of typing", not per keystroke.
 */
function useUrlWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return React.useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      mutate(sp);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
}

export function AuditLogClient() {
  const t = useTranslations("settings");
  const searchParams = useSearchParams();
  const writeUrl = useUrlWriter();

  const sp = React.useMemo(
    () => new URLSearchParams(searchParams?.toString() ?? ""),
    [searchParams],
  );
  const tab = readTab(sp);

  const setTab = React.useCallback(
    (next: Tab) => {
      writeUrl((u) => {
        if (next === "events") u.delete("tab");
        else u.set("tab", next);
      });
    },
    [writeUrl],
  );

  return (
    <PageContainer>
      <SectionHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
      />

      <div className="flex gap-2">
        <Button
          variant={tab === "events" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("events")}
        >
          {t("audit.tabs.events")}
        </Button>
        <Button
          variant={tab === "patientViews" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("patientViews")}
        >
          {t("audit.tabs.patientViews")}
        </Button>
      </div>

      {tab === "events" ? <EventsTab /> : <PatientViewsTab />}
    </PageContainer>
  );
}

function EventsTab() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const dateTag = intlLocale(locale);
  const searchParams = useSearchParams();
  const writeUrl = useUrlWriter();

  // URL is the source of truth; we hold a local mirror so typing feels
  // instant, then debounce the URL write.
  const urlFilters = React.useMemo(
    () => readEventsFilters(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );
  const [draft, setDraft] = React.useState<EventsFilters>(urlFilters);

  // Re-sync local draft when URL changes from the outside (back/forward,
  // links). Compare values, not reference, to avoid loops on identical state.
  React.useEffect(() => {
    if (
      EVENTS_KEYS.some((k) => draft[k] !== urlFilters[k])
    ) {
      setDraft(urlFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    urlFilters.entityType,
    urlFilters.action,
    urlFilters.actorId,
    urlFilters.from,
    urlFilters.to,
  ]);

  // Debounced write-back into the URL.
  React.useEffect(() => {
    const sameAsUrl = EVENTS_KEYS.every((k) => draft[k] === urlFilters[k]);
    if (sameAsUrl) return;
    const timer = setTimeout(() => {
      writeUrl((u) => {
        for (const k of EVENTS_KEYS) {
          if (draft[k]) u.set(`e_${k}`, draft[k]);
          else u.delete(`e_${k}`);
        }
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, urlFilters, writeUrl]);

  // The fetch keys off urlFilters, not draft — so we don't fire a request
  // per keystroke. The URL write itself is the throttle.
  const query = useInfiniteQuery<AuditPage, Error>({
    queryKey: ["settings", "audit", urlFilters],
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (urlFilters.entityType) params.set("entityType", urlFilters.entityType);
      if (urlFilters.action) params.set("action", urlFilters.action);
      if (urlFilters.actorId) params.set("actorId", urlFilters.actorId);
      if (urlFilters.from) params.set("from", urlFilters.from);
      if (urlFilters.to) params.set("to", urlFilters.to);
      params.set("limit", "100");
      if (pageParam) params.set("cursor", String(pageParam));
      return settingsFetch<AuditPage>(`/api/crm/audit?${params.toString()}`);
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
    <>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-5">
        <div>
          <Label htmlFor="a-entity">{t("audit.filters.entity")}</Label>
          <Input
            id="a-entity"
            placeholder="Patient, Appointment..."
            value={draft.entityType}
            onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="a-action">{t("audit.filters.action")}</Label>
          <Input
            id="a-action"
            placeholder="user.update"
            value={draft.action}
            onChange={(e) => setDraft({ ...draft, action: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="a-actor">{t("audit.filters.actor")}</Label>
          <Input
            id="a-actor"
            placeholder="userId"
            value={draft.actorId}
            onChange={(e) => setDraft({ ...draft, actorId: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="a-from">{t("audit.filters.from")}</Label>
          <Input
            id="a-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="a-to">{t("audit.filters.to")}</Label>
          <Input
            id="a-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
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
                      {new Date(row.createdAt).toLocaleString(dateTag)}
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
    </>
  );
}

/**
 * Phase 17 Wave 1 — PHI access tab.
 *
 * Lists rows from `PatientView`. ADMIN-only on the API side; the tab is shown
 * to everyone but the API will 403 non-ADMINs (their query just returns
 * Forbidden). We keep the UI simple — filters by patientId / viewerUserId /
 * date range / context.
 */
function PatientViewsTab() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const dateTag = intlLocale(locale);
  const searchParams = useSearchParams();
  const writeUrl = useUrlWriter();

  const urlFilters = React.useMemo(
    () => readPVFilters(new URLSearchParams(searchParams?.toString() ?? "")),
    [searchParams],
  );
  const [draft, setDraft] = React.useState<PVFilters>(urlFilters);

  React.useEffect(() => {
    if (PV_KEYS.some((k) => draft[k] !== urlFilters[k])) {
      setDraft(urlFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    urlFilters.patientId,
    urlFilters.viewerUserId,
    urlFilters.context,
    urlFilters.from,
    urlFilters.to,
  ]);

  React.useEffect(() => {
    const sameAsUrl = PV_KEYS.every((k) => draft[k] === urlFilters[k]);
    if (sameAsUrl) return;
    const timer = setTimeout(() => {
      writeUrl((u) => {
        for (const k of PV_KEYS) {
          if (draft[k]) u.set(`pv_${k}`, draft[k]);
          else u.delete(`pv_${k}`);
        }
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, urlFilters, writeUrl]);

  const query = useInfiniteQuery<PatientViewsPage, Error>({
    queryKey: ["settings", "audit", "patient-views", urlFilters],
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (urlFilters.patientId) params.set("patientId", urlFilters.patientId);
      if (urlFilters.viewerUserId)
        params.set("viewerUserId", urlFilters.viewerUserId);
      if (urlFilters.context) params.set("context", urlFilters.context);
      if (urlFilters.from) params.set("from", urlFilters.from);
      if (urlFilters.to) params.set("to", urlFilters.to);
      params.set("limit", "50");
      if (pageParam) params.set("cursor", String(pageParam));
      return settingsFetch<PatientViewsPage>(
        `/api/crm/audit/patient-views?${params.toString()}`,
      );
    },
  });

  const rows = React.useMemo(
    () => query.data?.pages.flatMap((p) => p.rows) ?? [],
    [query.data],
  );

  // Virtualize the row list. A regular <table> wouldn't tolerate the
  // absolute-positioned children that the virtualizer emits, so the body
  // is plain divs — column headers above the scroller hold the alignment.
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

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

  const contextLabel = (c: string) => {
    switch (c) {
      case "patient.detail":
        return t("audit.patientView.contextPatientDetail");
      case "appointment.drawer":
        return t("audit.patientView.contextAppointmentDrawer");
      case "case.detail":
        return t("audit.patientView.contextCaseDetail");
      case "export":
        return t("audit.patientView.contextExport");
      default:
        return c;
    }
  };

  return (
    <>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-5">
        <div>
          <Label htmlFor="pv-patient">
            {t("audit.patientView.filterPatient")}
          </Label>
          <Input
            id="pv-patient"
            placeholder="patientId"
            value={draft.patientId}
            onChange={(e) => setDraft({ ...draft, patientId: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="pv-viewer">
            {t("audit.patientView.filterViewer")}
          </Label>
          <Input
            id="pv-viewer"
            placeholder="userId"
            value={draft.viewerUserId}
            onChange={(e) =>
              setDraft({ ...draft, viewerUserId: e.target.value })
            }
          />
        </div>
        <div>
          <Label htmlFor="pv-context">
            {t("audit.patientView.filterContext")}
          </Label>
          <Input
            id="pv-context"
            placeholder="patient.detail | appointment.drawer | case.detail | export"
            value={draft.context}
            onChange={(e) => setDraft({ ...draft, context: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="pv-from">{t("audit.filters.from")}</Label>
          <Input
            id="pv-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="pv-to">{t("audit.filters.to")}</Label>
          <Input
            id="pv-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        {/* Sticky column header — matches the virtualized row layout below. */}
        <div className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_140px_minmax(0,1fr)] gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          <div>{t("audit.filters.from")}</div>
          <div>{t("audit.patientView.viewer")}</div>
          <div>{t("audit.patientView.patient")}</div>
          <div>{t("audit.patientView.context")}</div>
          <div>{t("audit.patientView.contextRef")}</div>
        </div>
        <div ref={parentRef} className="h-[65vh] overflow-auto">
          {query.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
              <ScrollIcon className="size-5" />
              {t("audit.patientView.empty")}
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
                    className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_140px_minmax(0,1fr)] gap-3 border-b border-border px-3 py-2 text-sm"
                  >
                    <div className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString(dateTag)}
                    </div>
                    <div className="min-w-0 truncate">
                      {row.viewer ? (
                        <span>
                          {row.viewer.name}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({row.viewerRole})
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.viewerUserId.slice(-6)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 truncate">
                      {row.patient ? (
                        <span>
                          {row.patient.fullName}
                          {row.patient.phone ? (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {row.patient.phone}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          #{row.patientId.slice(-6)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 truncate">
                      {contextLabel(row.context)}
                    </div>
                    <div className="min-w-0 truncate text-xs text-muted-foreground">
                      {row.contextRef ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
    </>
  );
}
