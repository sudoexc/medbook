"use client";

/**
 * «Мои частые» — what opens on tapping the diagnosis field with nothing
 * typed, the diagnosis and prescription pickers' columns (see
 * /api/crm/doctors/me/{diagnosis,drug}-shortlist), «Обычно при <диагноз>»
 * (/api/crm/doctors/me/diagnosis-memory), plus the one-tap «add this drug
 * to the clinic's base» mutation.
 */
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import {
  DEFAULT_FREQUENT_LIMIT,
  normalizeFrequentLimit,
  type ArsenalKind,
  type DrugArsenalSchema,
  type FrequentLimit,
} from "@/lib/arsenal";

import type { DrugSearchHit } from "./use-drug-search";

export type DiagnosisShortItem = {
  code: string | null;
  name: string;
  count: number;
  pinned: boolean;
};

export type DrugShortItem = {
  key: string;
  drugId: string | null;
  label: string;
  count: number;
  lastDose: string | null;
  /**
   * The form and strength of the row his last dose was written for, so the
   * pick comes back as he prescribed it (audit G4-07). Optional: a server
   * on the previous build omits them.
   */
  lastForm?: string | null;
  lastStrength?: string | null;
  /**
   * The schedule written with that last dose (times of day, meal, days):
   * a pick brings it back too. Optional for the same reason.
   */
  lastTimesOfDay?: string[];
  lastMealRelation?: string | null;
  lastDurationDays?: number | null;
  pinned: boolean;
  strengths: string[];
  drug: DrugSearchHit | null;
  /**
   * His only ever text line for a catalog drug (shortlist.ts): `label` is
   * the line, `drugId` the drug it names, `drug` null so a click puts the
   * line back as he wrote it.
   */
  lineOnly?: true;
  /**
   * «Мои» only: the schema he set on «Мой арсенал». A click applies it in
   * place of his last dose (prescription-rows.ts, draftFromShortItem).
   */
  arsenalSchema?: DrugArsenalSchema | null;
};

/** His last dose and schema of one catalog drug (no catalog data). */
export type DrugUsual = Pick<
  DrugShortItem,
  | "label"
  | "count"
  | "lastDose"
  | "lastForm"
  | "lastStrength"
  | "lastTimesOfDay"
  | "lastMealRelation"
  | "lastDurationDays"
>;

export type DrugShortlist = {
  /** Stars, then his most written: the corrections-era shortlist. */
  mine: DrugShortItem[];
  /** The clinic's core list minus `mine`. */
  clinic: DrugShortItem[];
  /** The picker's «Частые»: his most written, starred or not. */
  frequent: DrugShortItem[];
  /** The picker's «Мои»: his stars, in his order. */
  starred: DrugShortItem[];
  /** The clinic's whole core list, with his own dose where he has one. */
  core: DrugShortItem[];
  /** The core list's drug ids in clinic-wide use order. */
  coreRank: string[];
  /** His last dose and schema by drug id. */
  usual: Record<string, DrugUsual>;
  /** How many «Частые» he chose to see: 10, 20 or 30. */
  frequentLimit: FrequentLimit;
};

const EMPTY_SHORTLIST: DrugShortlist = {
  mine: [],
  clinic: [],
  frequent: [],
  starred: [],
  core: [],
  coreRank: [],
  usual: {},
  frequentLimit: DEFAULT_FREQUENT_LIMIT,
};

/** The diagnosis endpoint's lists (see diagnosis-shortlist/route.ts). */
export type DiagnosisShortlist = {
  /** Stars, then his most written: what the plain search field opens. */
  rows: DiagnosisShortItem[];
  /** The picker's «Частые»: his most written, starred or not. */
  frequent: DiagnosisShortItem[];
  /** The picker's «Мои»: his stars, in his order, named. */
  starred: DiagnosisShortItem[];
  /** `frequent` is his own, or the clinic's while he has written none. */
  frequentSource: "own" | "clinic";
  /** How many «Частые» he chose to see: 10, 20 or 30. */
  frequentLimit: FrequentLimit;
};

const EMPTY_DIAGNOSIS_SHORTLIST: DiagnosisShortlist = {
  rows: [],
  frequent: [],
  starred: [],
  frequentSource: "own",
  frequentLimit: DEFAULT_FREQUENT_LIMIT,
};

export const diagnosisShortlistKey = ["doctor", "reception", "dx-shortlist"] as const;
export const drugShortlistKey = ["doctor", "reception", "rx-shortlist"] as const;

const diagnosisShortlistQuery = (enabled: boolean) => ({
  queryKey: diagnosisShortlistKey,
  enabled,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<DiagnosisShortlist> => {
    const res = await fetch("/api/crm/doctors/me/diagnosis-shortlist", {
      credentials: "include",
      signal,
    });
    if (!res.ok) return EMPTY_DIAGNOSIS_SHORTLIST;
    const data = (await res.json()) as Partial<DiagnosisShortlist>;
    // Every list defaults: a server on the previous build sends only `rows`.
    return {
      rows: data.rows ?? [],
      frequent: data.frequent ?? [],
      starred: data.starred ?? [],
      frequentSource: data.frequentSource === "clinic" ? "clinic" : "own",
      frequentLimit: normalizeFrequentLimit(data.frequentLimit),
    };
  },
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});

/** The plain search field's list. One request with the picker's columns. */
export function useDiagnosisShortlist(enabled = true) {
  return useQuery({
    ...diagnosisShortlistQuery(enabled),
    select: (data: DiagnosisShortlist) => data.rows,
  });
}

/** The diagnosis picker's «Частые» and «Мои» columns. */
export function useDiagnosisColumns(enabled = true) {
  return useQuery(diagnosisShortlistQuery(enabled));
}

// ── «Обычно при <диагноз>» ─────────────────────────────────────────────

export type DiagnosisMemoryAdvice = { line: string; count: number };

/** What this doctor usually prescribes and recommends with one diagnosis. */
export type DiagnosisMemory = {
  /** His visits with it as the main diagnosis that held anything. */
  visits: number;
  /** Most often first; the `last*` fields carry his usual dose and schema. */
  prescriptions: DrugShortItem[];
  advice: DiagnosisMemoryAdvice[];
};

const EMPTY_MEMORY: DiagnosisMemory = { visits: 0, prescriptions: [], advice: [] };

/**
 * One diagnosis as the memory knows it: its code, or the words of one
 * written without a code. Null for an empty one.
 */
export function diagnosisMemoryTarget(d: {
  code?: string | null;
  name?: string | null;
}): { code: string } | { name: string } | null {
  const code = d.code?.trim().toUpperCase();
  if (code) return { code };
  const name = d.name?.trim().replace(/\s+/g, " ");
  return name ? { name } : null;
}

export function diagnosisMemoryKey(
  target: { code: string } | { name: string },
  excludeNoteId: string | null,
) {
  return [
    "doctor",
    "reception",
    "dx-memory",
    "code" in target ? `code:${target.code}` : `text:${target.name.toLowerCase()}`,
    excludeNoteId ?? "",
  ] as const;
}

/**
 * The memory of each visit diagnosis, in the visit's order. One query per
 * diagnosis: adding a second diagnosis does not reload the first one's.
 */
export function useDiagnosisMemories(
  diagnoses: readonly { code: string | null; name: string | null }[],
  excludeNoteId: string | null,
  enabled = true,
) {
  const targets = diagnoses.map(diagnosisMemoryTarget);
  return useQueries({
    queries: targets.map((target) => ({
      queryKey: target
        ? diagnosisMemoryKey(target, excludeNoteId)
        : (["doctor", "reception", "dx-memory", "none"] as const),
      enabled: enabled && !!target,
      queryFn: async ({ signal }: { signal: AbortSignal }): Promise<DiagnosisMemory> => {
        if (!target) return EMPTY_MEMORY;
        const params = new URLSearchParams(
          "code" in target ? { code: target.code } : { name: target.name },
        );
        if (excludeNoteId) params.set("exclude", excludeNoteId);
        const res = await fetch(
          `/api/crm/doctors/me/diagnosis-memory?${params.toString()}`,
          { credentials: "include", signal },
        );
        // A suggestion, never a blocker: a failed read shows nothing.
        if (!res.ok) return EMPTY_MEMORY;
        const data = (await res.json()) as Partial<DiagnosisMemory>;
        return {
          visits: data.visits ?? 0,
          prescriptions: data.prescriptions ?? [],
          advice: data.advice ?? [],
        };
      },
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
}

export function useDrugShortlist(enabled = true) {
  return useQuery<DrugShortlist>({
    queryKey: drugShortlistKey,
    enabled,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctors/me/drug-shortlist", {
        credentials: "include",
        signal,
      });
      if (!res.ok) return EMPTY_SHORTLIST;
      const data = (await res.json()) as Partial<DrugShortlist>;
      // Every list defaults: a server on the previous build sends only
      // `mine` and `clinic`.
      return {
        mine: data.mine ?? [],
        clinic: data.clinic ?? [],
        frequent: data.frequent ?? [],
        starred: data.starred ?? [],
        core: data.core ?? [],
        coreRank: data.coreRank ?? [],
        usual: data.usual ?? {},
        frequentLimit: normalizeFrequentLimit(data.frequentLimit),
      };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** The add was refused on purpose (e.g. the ADMIN hid that drug). */
export class AddClinicDrugError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`add drug ${status}${reason ? ` (${reason})` : ""}`);
  }
}

/**
 * Add a drug the catalog lacks to the clinic's base — visible to every
 * doctor from then on. Returns the existing row when the name is already
 * there under that exact spelling.
 */
export function useAddClinicDrug() {
  const qc = useQueryClient();
  return useMutation<{ drug: DrugSearchHit; created: boolean }, Error, string>({
    mutationFn: async (name) => {
      const res = await fetch("/api/crm/catalogs/drugs/custom", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        let reason: string | null = null;
        try {
          reason = ((await res.json()) as { reason?: string }).reason ?? null;
        } catch {
          reason = null;
        }
        throw new AddClinicDrugError(res.status, reason);
      }
      const data = (await res.json()) as {
        drug: DrugSearchHit | null;
        created: boolean;
      };
      if (!data.drug) throw new Error("add drug: empty");
      return { drug: data.drug, created: data.created };
    },
    onSuccess: () => {
      // The new name must be findable at once, here and in the reference.
      qc.invalidateQueries({ queryKey: ["doctor", "reception", "drug-search"] });
      qc.invalidateQueries({ queryKey: ["doctor", "references"] });
    },
  });
}

// ── «10 · 20 · 30» ─────────────────────────────────────────────────────

/**
 * His choice on a «Частые» column's «10 · 20 · 30» switch, saved on his
 * doctor card (per doctor, not per browser: cabinet PCs are shared). The
 * column follows at once from the cached list, which already holds his top
 * 30; the request only remembers the choice, and a failed one puts the old
 * choice back with a toast.
 *
 * Apart from React so the tests can drive it.
 */
export function frequentLimitOptions(
  qc: QueryClient,
  kind: ArsenalKind,
  onFailed?: (error: unknown) => void,
): MutationOptions<unknown, unknown, FrequentLimit, FrequentLimitContext> {
  const key = kind === "DRUG" ? drugShortlistKey : diagnosisShortlistKey;
  return {
    mutationKey: ["doctor", "reception", "frequent-limit", kind],
    scope: { id: `frequent-limit:${kind}` },
    mutationFn: async (limit) => {
      const res = await fetch("/api/crm/doctor-arsenal", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "limit", kind, limit }),
      });
      if (!res.ok) throw new Error(`frequent-limit ${res.status}`);
      return res.json();
    },
    onMutate: async (limit) => {
      // A click while the list is still loading must not cancel that load
      // (review of 03.10.2026): cancelled, the query went back to having no
      // data, nothing fetched it again and the column read «empty» until
      // the five minute staleTime ran out. With no list there is nothing to
      // set either; onSettled reloads it with the saved choice.
      if (qc.getQueryData(key) === undefined) return { before: null, applied: false };
      await qc.cancelQueries({ queryKey: key });
      let before: FrequentLimit | null = null;
      qc.setQueryData<{ frequentLimit: FrequentLimit } | undefined>(key, (cur) => {
        if (!cur) return cur;
        before = cur.frequentLimit;
        return { ...cur, frequentLimit: limit };
      });
      return { before, applied: true };
    },
    onError: (e, _limit, context) => {
      const before = context?.before;
      if (before) {
        qc.setQueryData<{ frequentLimit: FrequentLimit } | undefined>(key, (cur) =>
          cur ? { ...cur, frequentLimit: before } : cur,
        );
      }
      onFailed?.(e);
    },
    onSettled: (_data, error, limit, context) => {
      if (context?.applied !== false) return;
      // The load still in flight (or a new one) lands, then shows the
      // choice: that load may have been answered before the choice was
      // saved.
      void qc.invalidateQueries({ queryKey: key }).then(() => {
        if (error) return;
        qc.setQueryData<{ frequentLimit: FrequentLimit } | undefined>(key, (cur) =>
          cur ? { ...cur, frequentLimit: limit } : cur,
        );
      });
    },
  };
}

type FrequentLimitContext = { before: FrequentLimit | null; applied: boolean };

export function useSetFrequentLimit(kind: ArsenalKind) {
  const qc = useQueryClient();
  const t = useTranslations("doctor.reception.topSwitch");
  return useMutation(
    frequentLimitOptions(qc, kind, () =>
      toast.error(t("saveFailed"), { id: `frequent-limit-${kind}` }),
    ),
  );
}
