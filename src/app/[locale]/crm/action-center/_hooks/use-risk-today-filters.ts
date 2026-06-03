"use client";

/**
 * Filter state + facets for the "Сегодня в зоне риска" section.
 *
 * Three independent axes — doctor, reason kind, service — combine with AND.
 *
 * State source of truth, in priority order:
 *   1. URL search params (`riskDoc`, `riskReason`, `riskService`) — shareable,
 *      F5-safe, bookmarkable as "view Dr. X today".
 *   2. localStorage fallback — picks up yesterday's selection on the next
 *      morning when the URL is clean.
 *   3. Empty (everything visible) — the default.
 *
 * Facet counts are derived from the FULL unfiltered row set on purpose.
 * Counting after cross-application of other filters would make options
 * disappear / drop to 0 mid-interaction, which is more confusing than helpful
 * for a triage tool. With independent counts the chips stay stable: "Иванова
 * (5)" always means "5 patients with Иванова in the day's risk list", not
 * "5 ∩ already-applied-filters".
 */
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { Locale } from "@/lib/format";
import type { RiskReason, RiskTodayRow } from "./use-risk-today";

const STORAGE_KEY = "actionCenter.riskToday.filters.v1";

export type ReasonKind = RiskReason["kind"];
export const REASON_KINDS: ReasonKind[] = [
  "high_risk",
  "unconfirmed_24h",
  "no_contact",
];

export type RiskTodayFilters = {
  doctorIds: string[];
  reasonKinds: ReasonKind[];
  serviceIds: string[];
};

export const EMPTY_FILTERS: RiskTodayFilters = {
  doctorIds: [],
  reasonKinds: [],
  serviceIds: [],
};

export type DoctorFacet = {
  id: string;
  label: string;
  count: number;
};

export type ServiceFacet = {
  id: string;
  label: string;
  count: number;
};

export type ReasonFacet = {
  kind: ReasonKind;
  count: number;
};

export type RiskTodayFiltersApi = {
  filters: RiskTodayFilters;
  setDoctorIds: (next: string[]) => void;
  toggleDoctor: (id: string) => void;
  setReasonKinds: (next: ReasonKind[]) => void;
  toggleReason: (kind: ReasonKind) => void;
  setServiceIds: (next: string[]) => void;
  toggleService: (id: string) => void;
  reset: () => void;
  activeCount: number;
  facets: {
    doctors: DoctorFacet[];
    services: ServiceFacet[];
    reasons: ReasonFacet[];
  };
  filteredRows: RiskTodayRow[];
};

function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function parseReasonKinds(raw: string | null): ReasonKind[] {
  const allowed = new Set<ReasonKind>(REASON_KINDS);
  return parseCsv(raw).filter((k): k is ReasonKind =>
    allowed.has(k as ReasonKind),
  );
}

function readFromStorage(): RiskTodayFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RiskTodayFilters>;
    return {
      doctorIds: Array.isArray(parsed.doctorIds)
        ? parsed.doctorIds.filter((x): x is string => typeof x === "string")
        : [],
      reasonKinds: Array.isArray(parsed.reasonKinds)
        ? parsed.reasonKinds.filter((x): x is ReasonKind =>
            REASON_KINDS.includes(x as ReasonKind),
          )
        : [],
      serviceIds: Array.isArray(parsed.serviceIds)
        ? parsed.serviceIds.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function writeToStorage(filters: RiskTodayFilters): void {
  if (typeof window === "undefined") return;
  try {
    const hasAny =
      filters.doctorIds.length > 0 ||
      filters.reasonKinds.length > 0 ||
      filters.serviceIds.length > 0;
    if (!hasAny) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    /* quota / private mode — silently skip */
  }
}

type ParamsLike = { get(key: string): string | null } | null;

/**
 * Resolve initial filters from URL → localStorage → empty. The URL beats
 * storage so a shared link or back-button restore wins over yesterday's
 * sticky state.
 */
function resolveInitial(sp: ParamsLike): RiskTodayFilters {
  if (sp) {
    const fromUrl: RiskTodayFilters = {
      doctorIds: parseCsv(sp.get("riskDoc")),
      reasonKinds: parseReasonKinds(sp.get("riskReason")),
      serviceIds: parseCsv(sp.get("riskService")),
    };
    if (
      fromUrl.doctorIds.length ||
      fromUrl.reasonKinds.length ||
      fromUrl.serviceIds.length
    ) {
      return fromUrl;
    }
  }
  const fromStorage = readFromStorage();
  return fromStorage ?? EMPTY_FILTERS;
}

export function useRiskTodayFilters(
  rows: RiskTodayRow[] | undefined,
  locale: Locale,
): RiskTodayFiltersApi {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Snapshot the params once for initial state — we don't want the URL to
  // round-trip filters back into local state on every navigation event.
  const [filters, setFilters] = React.useState<RiskTodayFilters>(() =>
    resolveInitial(searchParams),
  );

  // On first client mount, if SSR rendered with empty filters but storage
  // had something AND the URL is clean, hydrate from storage. Avoids server
  // / client markup mismatch by deferring to useEffect.
  const hydratedRef = React.useRef(false);
  React.useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const sp = searchParams;
    const urlHasFilters =
      Boolean(sp?.get("riskDoc")) ||
      Boolean(sp?.get("riskReason")) ||
      Boolean(sp?.get("riskService"));
    if (urlHasFilters) return;
    const stored = readFromStorage();
    if (stored) setFilters(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist to URL + storage on every change.
  const writeBack = React.useCallback(
    (next: RiskTodayFilters) => {
      setFilters(next);
      writeToStorage(next);
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      const set = (key: string, value: string) => {
        if (value) sp.set(key, value);
        else sp.delete(key);
      };
      set("riskDoc", next.doctorIds.join(","));
      set("riskReason", next.reasonKinds.join(","));
      set("riskService", next.serviceIds.join(","));
      const query = sp.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const setDoctorIds = React.useCallback(
    (next: string[]) =>
      writeBack({ ...filters, doctorIds: Array.from(new Set(next)) }),
    [filters, writeBack],
  );

  const toggleDoctor = React.useCallback(
    (id: string) => {
      const present = filters.doctorIds.includes(id);
      const nextIds = present
        ? filters.doctorIds.filter((x) => x !== id)
        : [...filters.doctorIds, id];
      writeBack({ ...filters, doctorIds: nextIds });
    },
    [filters, writeBack],
  );

  const setReasonKinds = React.useCallback(
    (next: ReasonKind[]) =>
      writeBack({ ...filters, reasonKinds: Array.from(new Set(next)) }),
    [filters, writeBack],
  );

  const toggleReason = React.useCallback(
    (kind: ReasonKind) => {
      const present = filters.reasonKinds.includes(kind);
      const nextKinds = present
        ? filters.reasonKinds.filter((x) => x !== kind)
        : [...filters.reasonKinds, kind];
      writeBack({ ...filters, reasonKinds: nextKinds });
    },
    [filters, writeBack],
  );

  const setServiceIds = React.useCallback(
    (next: string[]) =>
      writeBack({ ...filters, serviceIds: Array.from(new Set(next)) }),
    [filters, writeBack],
  );

  const toggleService = React.useCallback(
    (id: string) => {
      const present = filters.serviceIds.includes(id);
      const nextIds = present
        ? filters.serviceIds.filter((x) => x !== id)
        : [...filters.serviceIds, id];
      writeBack({ ...filters, serviceIds: nextIds });
    },
    [filters, writeBack],
  );

  const reset = React.useCallback(
    () => writeBack(EMPTY_FILTERS),
    [writeBack],
  );

  const activeCount =
    filters.doctorIds.length +
    filters.reasonKinds.length +
    filters.serviceIds.length;

  const facets = React.useMemo(() => {
    const safeRows = rows ?? [];

    // Doctor facets — derived from the unfiltered row set. Stable order:
    // descending count, then alphabetical (locale-aware) tiebreak so the
    // most loaded doctors lead but the list is predictable.
    const doctorAgg = new Map<
      string,
      { id: string; nameRu: string; nameUz: string; count: number }
    >();
    for (const r of safeRows) {
      const prev = doctorAgg.get(r.doctorId);
      if (prev) {
        prev.count += 1;
      } else {
        doctorAgg.set(r.doctorId, {
          id: r.doctorId,
          nameRu: r.doctorName.ru,
          nameUz: r.doctorName.uz,
          count: 1,
        });
      }
    }
    const doctors: DoctorFacet[] = Array.from(doctorAgg.values())
      .map((d) => ({
        id: d.id,
        label: locale === "uz" ? d.nameUz : d.nameRu,
        count: d.count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    // Service facets — same shape. Rows without a service contribute to a
    // synthetic "no-service" bucket only if any exist; otherwise we hide it
    // to keep the dropdown tight.
    const serviceAgg = new Map<
      string,
      { id: string; nameRu: string; nameUz: string; count: number }
    >();
    let noServiceCount = 0;
    for (const r of safeRows) {
      if (!r.serviceId || !r.serviceName) {
        noServiceCount += 1;
        continue;
      }
      const prev = serviceAgg.get(r.serviceId);
      if (prev) {
        prev.count += 1;
      } else {
        serviceAgg.set(r.serviceId, {
          id: r.serviceId,
          nameRu: r.serviceName.ru,
          nameUz: r.serviceName.uz,
          count: 1,
        });
      }
    }
    const services: ServiceFacet[] = Array.from(serviceAgg.values())
      .map((s) => ({
        id: s.id,
        label: locale === "uz" ? s.nameUz : s.nameRu,
        count: s.count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (noServiceCount > 0) {
      services.push({ id: "__none__", label: "—", count: noServiceCount });
    }

    // Reason facets — count rows that contain at least one reason of each
    // kind. A row with both `high_risk` and `unconfirmed_24h` counts in
    // both buckets — that matches user intent ("show everyone with X").
    const reasonAgg = new Map<ReasonKind, number>();
    for (const kind of REASON_KINDS) reasonAgg.set(kind, 0);
    for (const r of safeRows) {
      const kinds = new Set(r.reasons.map((x) => x.kind));
      for (const k of kinds) {
        reasonAgg.set(k, (reasonAgg.get(k) ?? 0) + 1);
      }
    }
    const reasons: ReasonFacet[] = REASON_KINDS.map((kind) => ({
      kind,
      count: reasonAgg.get(kind) ?? 0,
    }));

    return { doctors, services, reasons };
  }, [rows, locale]);

  const filteredRows = React.useMemo(() => {
    const safeRows = rows ?? [];
    if (
      filters.doctorIds.length === 0 &&
      filters.reasonKinds.length === 0 &&
      filters.serviceIds.length === 0
    ) {
      return safeRows;
    }
    const doctorSet = new Set(filters.doctorIds);
    const reasonSet = new Set(filters.reasonKinds);
    const serviceSet = new Set(filters.serviceIds);
    const wantNoService = serviceSet.has("__none__");

    return safeRows.filter((r) => {
      if (doctorSet.size > 0 && !doctorSet.has(r.doctorId)) return false;
      if (reasonSet.size > 0) {
        const has = r.reasons.some((x) => reasonSet.has(x.kind));
        if (!has) return false;
      }
      if (serviceSet.size > 0) {
        const isNone = !r.serviceId;
        const matchesNamed = r.serviceId && serviceSet.has(r.serviceId);
        if (wantNoService && isNone) {
          /* match */
        } else if (matchesNamed) {
          /* match */
        } else {
          return false;
        }
      }
      return true;
    });
  }, [rows, filters]);

  return {
    filters,
    setDoctorIds,
    toggleDoctor,
    setReasonKinds,
    toggleReason,
    setServiceIds,
    toggleService,
    reset,
    activeCount,
    facets,
    filteredRows,
  };
}
