"use client";

/**
 * «Мой арсенал» data: GET/POST/DELETE/PATCH /api/crm/doctor-arsenal for one
 * doctor (the caller's own card, or `doctorId` for the clinic's ADMIN).
 *
 * Every write is optimistic (the page is worked with the mouse, and a list
 * that lags a click behind invites a second click) and runs in one queue
 * per arsenal, so «add, then drag it up» reaches the server in that order.
 * A failed write puts the server's list back and says why.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type {
  ArsenalKind,
  DrugArsenalSchema,
  FrequentLimit,
} from "@/lib/arsenal";
import { doctorFavoritesKey } from "@/app/[locale]/doctor/reception/_hooks/use-doctor-favorites";
import {
  diagnosisShortlistKey,
  drugShortlistKey,
  type DiagnosisShortItem,
  type DrugShortItem,
} from "@/app/[locale]/doctor/reception/_hooks/use-shortlists";

export type ArsenalDoctorName = { id: string; nameRu: string; nameUz: string };

export type ArsenalDrugPin = {
  code: string;
  schema: DrugArsenalSchema | null;
  /** Null: the drug is no longer visible (retired, hidden by the clinic). */
  entry: DrugShortItem | null;
};

export type ArsenalDiagnosisPin = { code: string; name: string | null; count: number };

export type DrugArsenal = {
  doctor: ArsenalDoctorName;
  kind: "DRUG";
  max: number;
  frequentLimit: FrequentLimit;
  items: ArsenalDrugPin[];
  /** His top 30 not in the arsenal yet. */
  top: DrugShortItem[];
  /** The clinic's core list not in the arsenal yet, by clinic-wide use. */
  core: DrugShortItem[];
};

export type DiagnosisArsenal = {
  doctor: ArsenalDoctorName;
  kind: "ICD10";
  max: number;
  frequentLimit: FrequentLimit;
  items: ArsenalDiagnosisPin[];
  top: DiagnosisShortItem[];
  topSource: "own" | "clinic";
};

export type ArsenalData<K extends ArsenalKind> = K extends "DRUG" ? DrugArsenal : DiagnosisArsenal;

/** A refused request, with the server's reason (`arsenal_full`, …). */
export class ArsenalError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`doctor-arsenal ${status}${reason ? ` (${reason})` : ""}`);
  }
}

export function arsenalKey(kind: ArsenalKind, doctorId: string | null | undefined) {
  return ["doctor-arsenal", kind, doctorId ?? "me"] as const;
}

async function readError(res: Response): Promise<ArsenalError> {
  let reason: string | null = null;
  try {
    reason = ((await res.json()) as { reason?: string }).reason ?? null;
  } catch {
    reason = null;
  }
  return new ArsenalError(res.status, reason);
}

async function send(method: "POST" | "DELETE" | "PATCH", body: Record<string, unknown>) {
  const res = await fetch("/api/crm/doctor-arsenal", {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return res.json() as Promise<unknown>;
}

export function useArsenal<K extends ArsenalKind>(kind: K, doctorId?: string | null) {
  return useQuery<ArsenalData<K>, ArsenalError>({
    queryKey: arsenalKey(kind, doctorId),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ kind });
      if (doctorId) params.set("doctorId", doctorId);
      const res = await fetch(`/api/crm/doctor-arsenal?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw await readError(res);
      return (await res.json()) as ArsenalData<K>;
    },
    // A refusal (no login on the card, not his arsenal) is an answer.
    retry: (count, error) => error.status >= 500 && count < 2,
    staleTime: 30_000,
  });
}

/**
 * After a write: the page reloads its lists; the doctor's own visit screen
 * (his stars, his «Частые» switch) reloads when he is the one editing. An
 * ADMIN's own favourites are not this doctor's, so they stay as they are.
 */
function settle(qc: QueryClient, kind: ArsenalKind, doctorId: string | null | undefined) {
  void qc.invalidateQueries({ queryKey: arsenalKey(kind, doctorId) });
  if (doctorId) return;
  void qc.invalidateQueries({ queryKey: doctorFavoritesKey(kind) });
  void qc.invalidateQueries({
    queryKey: kind === "DRUG" ? drugShortlistKey : diagnosisShortlistKey,
    refetchType: "none",
  });
}

type Snapshot = { before: unknown };

export function useArsenalMutations(kind: ArsenalKind, doctorId?: string | null) {
  const qc = useQueryClient();
  const t = useTranslations("doctor.arsenal");
  const key = arsenalKey(kind, doctorId);
  const scope = { id: `doctor-arsenal:${kind}:${doctorId ?? "me"}` };
  const target = doctorId ? { doctorId } : {};

  const snapshot = async (): Promise<Snapshot> => {
    await qc.cancelQueries({ queryKey: key });
    return { before: qc.getQueryData(key) };
  };
  const failed = (e: unknown, ctx: Snapshot | undefined) => {
    if (ctx?.before !== undefined) qc.setQueryData(key, ctx.before);
    const reason = e instanceof ArsenalError ? e.reason : null;
    toast.error(
      reason === "arsenal_full"
        ? t("toast.full")
        : reason === "order_stale"
          ? t("toast.stale")
          : t("toast.saveFailed"),
      { id: "doctor-arsenal-save" },
    );
  };
  const done = () => settle(qc, kind, doctorId);

  const add = useMutation<unknown, unknown, { code: string; item: unknown }, Snapshot>({
    scope,
    mutationFn: ({ code }) => send("POST", { ...target, kind, code }),
    onMutate: async ({ code, item }) => {
      const ctx = await snapshot();
      qc.setQueryData(key, (cur: unknown) => withAdded(kind, cur, code, item));
      return ctx;
    },
    onError: (e, _v, ctx) => failed(e, ctx),
    onSettled: done,
  });

  const remove = useMutation<unknown, unknown, { code: string }, Snapshot>({
    scope,
    mutationFn: ({ code }) => send("DELETE", { ...target, kind, code }),
    onMutate: async ({ code }) => {
      const ctx = await snapshot();
      qc.setQueryData(key, (cur: unknown) => withRemoved(cur, code));
      return ctx;
    },
    onError: (e, _v, ctx) => failed(e, ctx),
    onSettled: done,
  });

  const reorder = useMutation<unknown, unknown, { codes: string[] }, Snapshot>({
    scope,
    mutationFn: ({ codes }) => send("PATCH", { ...target, op: "reorder", kind, codes }),
    onMutate: async ({ codes }) => {
      const ctx = await snapshot();
      qc.setQueryData(key, (cur: unknown) => withOrder(cur, codes));
      return ctx;
    },
    onError: (e, _v, ctx) => failed(e, ctx),
    onSettled: done,
  });

  const setSchema = useMutation<
    unknown,
    unknown,
    { code: string; schema: DrugArsenalSchema | null },
    Snapshot
  >({
    scope,
    mutationFn: ({ code, schema }) => send("PATCH", { ...target, op: "schema", code, schema }),
    onMutate: async ({ code, schema }) => {
      const ctx = await snapshot();
      qc.setQueryData(key, (cur: unknown) => withSchema(cur, code, schema));
      return ctx;
    },
    onError: (e, _v, ctx) => failed(e, ctx),
    onSettled: done,
  });

  const setLimit = useMutation<unknown, unknown, FrequentLimit, Snapshot>({
    scope,
    mutationFn: (limit) => send("PATCH", { ...target, op: "limit", kind, limit }),
    onMutate: async (limit) => {
      const ctx = await snapshot();
      qc.setQueryData(key, (cur: unknown) =>
        cur && typeof cur === "object" ? { ...cur, frequentLimit: limit } : cur,
      );
      return ctx;
    },
    onError: (e, _v, ctx) => failed(e, ctx),
    onSettled: () => {
      done();
      if (!doctorId) {
        void qc.invalidateQueries({
          queryKey: kind === "DRUG" ? drugShortlistKey : diagnosisShortlistKey,
        });
      }
    },
  });

  return { add, remove, reorder, setSchema, setLimit };
}

// ── Optimistic edits (pure, exported for the tests) ─────────────────────

type ListShape = { items: { code: string }[]; top?: unknown[]; core?: unknown[] };

function isList(v: unknown): v is ListShape {
  return !!v && typeof v === "object" && Array.isArray((v as ListShape).items);
}

const codeOfSource = (kind: ArsenalKind, item: unknown): string | null => {
  if (!item || typeof item !== "object") return null;
  const o = item as { drugId?: string | null; code?: string | null };
  return kind === "DRUG" ? (o.drugId ?? null) : (o.code?.toUpperCase() ?? null);
};

/** The list with `code` pinned at the end, gone from the sources it came from. */
export function withAdded(kind: ArsenalKind, cur: unknown, code: string, item: unknown): unknown {
  if (!isList(cur)) return cur;
  if (cur.items.some((i) => i.code === code)) return cur;
  const pin =
    kind === "DRUG"
      ? { code, schema: null, entry: item ?? null }
      : {
          code,
          name: (item as { name?: string } | null)?.name ?? null,
          count: (item as { count?: number } | null)?.count ?? 0,
        };
  const notIt = (s: unknown) => codeOfSource(kind, s) !== code;
  return {
    ...cur,
    items: [...cur.items, pin],
    ...(cur.top ? { top: cur.top.filter(notIt) } : {}),
    ...(cur.core ? { core: cur.core.filter(notIt) } : {}),
  };
}

export function withRemoved(cur: unknown, code: string): unknown {
  if (!isList(cur)) return cur;
  return { ...cur, items: cur.items.filter((i) => i.code !== code) };
}

/** The list in the dragged order; codes it does not know are ignored. */
export function withOrder(cur: unknown, codes: readonly string[]): unknown {
  if (!isList(cur)) return cur;
  const byCode = new Map(cur.items.map((i) => [i.code, i]));
  const ordered = codes.map((c) => byCode.get(c)).filter((i): i is { code: string } => !!i);
  const rest = cur.items.filter((i) => !codes.includes(i.code));
  return { ...cur, items: [...ordered, ...rest] };
}

export function withSchema(
  cur: unknown,
  code: string,
  schema: DrugArsenalSchema | null,
): unknown {
  if (!isList(cur)) return cur;
  return {
    ...cur,
    items: cur.items.map((i) => (i.code === code ? { ...i, schema } : i)),
  };
}
