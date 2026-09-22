"use client";

/**
 * «Чем заменить» — the block a pharmacy catalog cannot have.
 *
 * A shop lists what it stocks. We know the molecule and the ATC class of
 * every drug registered in the country, so the doctor gets the answer to the
 * question patients actually ask at the counter: «этого нет, что взять
 * вместо?» Two tiers, because they are clinically different things — the
 * same substance is a swap, the same class is a decision.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeftIcon, Loader2Icon } from "lucide-react";

type SimilarResponse = {
  brands: { name: string; manufacturer: string | null }[];
  alternatives: {
    id: string;
    nameRu: string;
    atcCode: string | null;
    rxOnly: boolean;
    photoUrl: string | null;
    brandNames: string[];
  }[];
};

export function DrugSimilar({
  drugId,
  onOpenDrug,
}: {
  drugId: string;
  /** Jump to another drug's card without leaving the reference. */
  onOpenDrug?: (id: string) => void;
}) {
  const t = useTranslations("doctor.references");
  const query = useQuery<SimilarResponse, Error>({
    queryKey: ["doctor", "references", "drug-similar", drugId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/catalogs/drugs/${drugId}/similar`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`similar: ${res.status}`);
      return (await res.json()) as SimilarResponse;
    },
    staleTime: 10 * 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center border-t px-4 py-4">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const data = query.data;
  if (!data) return null;
  const hasBrands = data.brands.length > 0;
  const hasAlts = data.alternatives.length > 0;
  if (!hasBrands && !hasAlts) return null;

  return (
    <section className="border-t px-4 py-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ArrowRightLeftIcon className="size-3.5" />
        {t("drugs.similarTitle")}
      </h4>

      {hasBrands ? (
        <div className="mt-2">
          <p className="text-[11px] text-muted-foreground">
            {t("drugs.sameSubstance")}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {data.brands.map((b) => (
              <span
                key={b.name}
                title={b.manufacturer ?? undefined}
                className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {b.name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {hasAlts ? (
        <div className="mt-3">
          <p className="text-[11px] text-muted-foreground">
            {t("drugs.sameClass")}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {data.alternatives.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={!onOpenDrug}
                  onClick={() => onOpenDrug?.(a.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {a.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.photoUrl}
                      alt=""
                      className="size-6 shrink-0 rounded border border-border bg-white object-contain"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {a.nameRu}
                    {a.brandNames.length > 0 ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {a.brandNames.join(", ")}
                      </span>
                    ) : null}
                  </span>
                  {a.atcCode ? (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {a.atcCode}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {t("drugs.sameClassHint")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
