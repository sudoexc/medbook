"use client";

/**
 * «Чем заменить» — the block a pharmacy catalog cannot have.
 *
 * A shop lists what it stocks. We know the molecule and the ATC class of
 * every drug registered in the country, so the doctor gets the answer to the
 * question patients actually ask at the counter: «этого нет, что взять
 * вместо?» Two tiers, because they are clinically different things — the
 * same substance is a swap, the same class is a decision.
 *
 * A click on an analogue hands the caller that analogue's FULL card. The
 * callers used to receive a bare id and look it up among the rows they had
 * loaded; an analogue from the same ATC class is almost never among them, so
 * the reference silently did nothing and the prescription drawer fell back
 * to its first search result: the doctor read a different drug's
 * contraindications (audit CT-01).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeftIcon, Loader2Icon } from "lucide-react";

import type { DrugDetail } from "../../_components/drug-detail";
import { fetchDrugById } from "../_hooks/use-drug-catalog";

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
  onOpenDrug?: (drug: DrugDetail) => void;
}) {
  const t = useTranslations("doctor.references");
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [failedId, setFailedId] = React.useState<string | null>(null);
  // Only the latest click may open a card: a slow answer for an earlier
  // click must not replace the analogue the doctor chose after it, nor a
  // card he has since opened some other way.
  const latestClick = React.useRef(0);

  // A new card means a new list: drop the previous card's pending click.
  React.useEffect(() => {
    latestClick.current += 1;
    setPendingId(null);
    setFailedId(null);
  }, [drugId]);

  const openAnalogue = async (id: string) => {
    if (!onOpenDrug) return;
    const click = ++latestClick.current;
    setPendingId(id);
    setFailedId(null);
    try {
      const drug = await queryClient.fetchQuery({
        queryKey: ["doctor", "references", "drug-by-id", id],
        queryFn: ({ signal }) => fetchDrugById(id, signal),
        staleTime: 10 * 60_000,
      });
      if (click !== latestClick.current) return;
      if (drug) onOpenDrug(drug);
      else setFailedId(id);
    } catch {
      if (click === latestClick.current) setFailedId(id);
    } finally {
      if (click === latestClick.current) setPendingId(null);
    }
  };

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
                  aria-busy={pendingId === a.id}
                  onClick={() => void openAnalogue(a.id)}
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
                  {pendingId === a.id ? (
                    <Loader2Icon className="size-3 shrink-0 animate-spin text-muted-foreground" />
                  ) : a.atcCode ? (
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {a.atcCode}
                    </span>
                  ) : null}
                </button>
                {failedId === a.id ? (
                  <p role="alert" className="px-1.5 pb-1 text-[11px] text-destructive">
                    {t("drugs.similarOpenError")}
                  </p>
                ) : null}
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
