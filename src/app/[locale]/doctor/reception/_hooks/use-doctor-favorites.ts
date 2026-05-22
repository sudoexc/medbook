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
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type CatalogEntityType =
  | "DRUG"
  | "PROTOCOL"
  | "HANDOUT"
  | "LAB_TEST"
  | "LAB_PANEL";

export type DoctorFavoriteRow = {
  id: string;
  userId: string;
  entityType: CatalogEntityType;
  entityCode: string;
  sortOrder: number;
  createdAt: string;
};

async function fetchFavorites(
  entityType: CatalogEntityType,
): Promise<DoctorFavoriteRow[]> {
  const res = await fetch(
    `/api/crm/doctor-favorites?entityType=${entityType}`,
    { credentials: "include" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { favorites?: DoctorFavoriteRow[] };
  return data.favorites ?? [];
}

async function postFavorite(
  entityType: CatalogEntityType,
  entityCode: string,
): Promise<void> {
  await fetch("/api/crm/doctor-favorites", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityType, entityCode }),
  });
}

async function deleteFavorite(
  entityType: CatalogEntityType,
  entityCode: string,
): Promise<void> {
  await fetch("/api/crm/doctor-favorites", {
    method: "DELETE",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityType, entityCode }),
  });
}

export function useDoctorFavorites(entityType: CatalogEntityType) {
  const queryClient = useQueryClient();
  const queryKey = ["doctor-favorites", entityType] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchFavorites(entityType),
    staleTime: 30_000,
  });

  const favorites = React.useMemo(() => query.data ?? [], [query.data]);
  const pinned = React.useMemo(
    () => new Set(favorites.map((f) => f.entityCode)),
    [favorites],
  );

  const mutation = useMutation({
    mutationFn: async (entityCode: string) => {
      if (pinned.has(entityCode)) {
        await deleteFavorite(entityType, entityCode);
      } else {
        await postFavorite(entityType, entityCode);
      }
    },
    // Optimistic update — toggle the pinned set immediately so the star
    // doesn't lag a roundtrip behind. On error we restore the snapshot.
    onMutate: async (entityCode: string) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DoctorFavoriteRow[]>(queryKey);
      const isPinned = pinned.has(entityCode);
      const next = isPinned
        ? (previous ?? []).filter((f) => f.entityCode !== entityCode)
        : [
            ...(previous ?? []),
            {
              id: `optimistic-${entityCode}`,
              userId: "self",
              entityType,
              entityCode,
              sortOrder: Math.floor(Date.now() / 1000),
              createdAt: new Date().toISOString(),
            } satisfies DoctorFavoriteRow,
          ];
      queryClient.setQueryData(queryKey, next);
      return { previous };
    },
    onError: (_err, _entityCode, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const toggle = React.useCallback(
    (entityCode: string) => mutation.mutate(entityCode),
    [mutation],
  );

  return {
    favorites,
    pinned,
    isLoading: query.isLoading,
    toggle,
    isToggling: mutation.isPending,
  };
}
