"use client";

/**
 * Phase G6 — per-user catalog favourites.
 *
 * Wraps GET/POST/DELETE /api/crm/doctor-favorites and exposes:
 *   - the Set of pinned `entityCode`s for a given entityType (for star tinting)
 *   - a `toggle(entityCode)` mutation that flips pinned <-> unpinned
 *
 * Cache key is per-entityType so the drug drawer and handout drawer can each
 * use their own slice without invalidating each other.
 *
 * Audit CT-14: a failed request is an error, never «no favourites». The GET
 * used to fold a 401/500 into an empty list, so every star vanished during
 * an API blip; POST and DELETE never looked at the status, so the optimistic
 * star stayed lit on a 500. Both now throw: the query keeps its cached stars
 * and a failed toggle rolls back, each with a toast.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";

export type CatalogEntityType =
  | "DRUG"
  | "PROTOCOL"
  | "HANDOUT"
  | "LAB_TEST"
  | "LAB_PANEL"
  | "ICD10";

export type DoctorFavoriteRow = {
  id: string;
  userId: string;
  entityType: CatalogEntityType;
  entityCode: string;
  sortOrder: number;
  createdAt: string;
};

export function doctorFavoritesKey(entityType: CatalogEntityType) {
  return ["doctor-favorites", entityType] as const;
}

export async function fetchFavorites(
  entityType: CatalogEntityType,
): Promise<DoctorFavoriteRow[]> {
  const res = await fetch(
    `/api/crm/doctor-favorites?entityType=${entityType}`,
    { credentials: "include" },
  );
  // Thrown, not folded into []: TanStack then keeps the last good list.
  if (!res.ok) throw new Error(`doctor-favorites GET ${res.status}`);
  const data = (await res.json()) as { favorites?: DoctorFavoriteRow[] };
  return data.favorites ?? [];
}

async function writeFavorite(
  method: "POST" | "DELETE",
  entityType: CatalogEntityType,
  entityCode: string,
): Promise<void> {
  const res = await fetch("/api/crm/doctor-favorites", {
    method,
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityType, entityCode }),
  });
  // Without this a 4xx/5xx resolved, and onError (the rollback) never ran.
  if (!res.ok) throw new Error(`doctor-favorites ${method} ${res.status}`);
}

/** One star click: which code, and whether it is being pinned or unpinned. */
export type FavoriteToggle = { entityCode: string; pin: boolean };

/** The list with `entityCode` pinned (appended) or unpinned. */
function withFavorite(
  list: readonly DoctorFavoriteRow[],
  entityType: CatalogEntityType,
  entityCode: string,
  pin: boolean,
): DoctorFavoriteRow[] {
  const has = list.some((f) => f.entityCode === entityCode);
  if (pin === has) return [...list];
  if (!pin) return list.filter((f) => f.entityCode !== entityCode);
  return [
    ...list,
    {
      id: `optimistic-${entityCode}`,
      userId: "self",
      entityType,
      entityCode,
      sortOrder: Math.floor(Date.now() / 1000),
      createdAt: new Date().toISOString(),
    },
  ];
}

/**
 * The toggle mutation, apart from React so the tests can drive it.
 *
 * The direction travels with the click instead of being read from a render
 * closure inside mutationFn: a quick double click on a stale closure sent
 * DELETE for a star whose POST had not landed yet. Toggles of one list share
 * a scope, so their requests run one after another in click order (their
 * optimistic updates still apply at once).
 */
export function favoriteToggleOptions(
  queryClient: QueryClient,
  entityType: CatalogEntityType,
  onFailed?: () => void,
) {
  const queryKey = doctorFavoritesKey(entityType);
  const mutationKey = [...queryKey, "toggle"] as const;
  return {
    mutationKey,
    scope: { id: `doctor-favorites:${entityType}` },
    mutationFn: ({ entityCode, pin }: FavoriteToggle) =>
      writeFavorite(pin ? "POST" : "DELETE", entityType, entityCode),
    // Optimistic update — toggle the pinned set immediately so the star
    // doesn't lag a roundtrip behind.
    onMutate: async ({ entityCode, pin }: FavoriteToggle) => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<DoctorFavoriteRow[]>(queryKey, (cur) =>
        withFavorite(cur ?? [], entityType, entityCode, pin),
      );
    },
    // Undo this click only, on the list as it is now: restoring a snapshot
    // taken at click time would also undo a star clicked since.
    onError: (_err: unknown, { entityCode, pin }: FavoriteToggle) => {
      queryClient.setQueryData<DoctorFavoriteRow[]>(queryKey, (cur) =>
        withFavorite(cur ?? [], entityType, entityCode, !pin),
      );
      onFailed?.();
    },
    onSettled: () => {
      // A refetch while another toggle of this list is still in flight would
      // overwrite its optimistic star with the server's older answer: only
      // the last one settling reloads the list.
      const last = queryClient.isMutating({ mutationKey }) <= 1;
      if (last) {
        void queryClient.invalidateQueries({ queryKey });
      }
      // The diagnosis field's «мои частые» puts stars first, so a star
      // reorders it: never under the doctor's cursor while the list is
      // open. Marked stale only, the field refetches it when it opens next.
      if (entityType === "ICD10") {
        void queryClient.invalidateQueries({
          queryKey: ["doctor", "reception", "dx-shortlist"],
          refetchType: "none",
        });
      }
      // The prescription picker's «Мои» shows a star only with the drug's
      // data, and a drug starred in the «Каталог» window is in none of the
      // picker's lists: it stayed out of «Мои» until a reload, because the
      // always mounted picker never refetched a list only marked stale
      // (review of 03.10.2026). Its columns do not reorder on a star
      // («Частые» counts visits, «Мои» follows the stars' order), so the
      // open picker refetches at once, after the last star of a burst.
      if (entityType === "DRUG") {
        void queryClient.invalidateQueries({
          queryKey: ["doctor", "reception", "rx-shortlist"],
          refetchType: last ? "active" : "none",
        });
      }
    },
  };
}

/** Pin or unpin, decided from the list as it stands right now (the cache). */
export function nextFavoriteToggle(
  queryClient: QueryClient,
  entityType: CatalogEntityType,
  entityCode: string,
): FavoriteToggle {
  const current =
    queryClient.getQueryData<DoctorFavoriteRow[]>(
      doctorFavoritesKey(entityType),
    ) ?? [];
  return {
    entityCode,
    pin: !current.some((f) => f.entityCode === entityCode),
  };
}

export function useDoctorFavorites(entityType: CatalogEntityType) {
  const t = useTranslations("doctor.receptionDialogs");
  const queryClient = useQueryClient();
  const queryKey = doctorFavoritesKey(entityType);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchFavorites(entityType),
    staleTime: 30_000,
  });

  // Several pickers mount this hook at once: one toast id says it once.
  React.useEffect(() => {
    if (query.isError) {
      toast.error(t("favorites.loadFailed"), { id: "doctor-favorites-load" });
    }
  }, [query.isError, t]);

  const favorites = React.useMemo(() => query.data ?? [], [query.data]);
  const pinned = React.useMemo(
    () => new Set(favorites.map((f) => f.entityCode)),
    [favorites],
  );

  const mutation = useMutation(
    favoriteToggleOptions(queryClient, entityType, () =>
      toast.error(t("favorites.saveFailed"), { id: "doctor-favorites-save" }),
    ),
  );

  const { mutate } = mutation;
  const toggle = React.useCallback(
    (entityCode: string) =>
      mutate(nextFavoriteToggle(queryClient, entityType, entityCode)),
    [mutate, queryClient, entityType],
  );

  return {
    favorites,
    pinned,
    isLoading: query.isLoading,
    toggle,
    isToggling: mutation.isPending,
  };
}
