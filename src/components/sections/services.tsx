import { useLocale, useTranslations } from "next-intl";

import { formatDate } from "@/lib/format";
import {
  PRICE_GROUPS,
  formatSumAmount,
  type SitePriceSheet,
} from "@/lib/site-prices";

type PriceItem = { name: string; note?: string };

// The price list as one printed «прейскурант» sheet: a single bordered
// paper, group headers as full-width bands, and a dotted leader tying each
// name to its price — the classic device that keeps the eye on the line.
// The previous two-column layout collapsed into a short column next to a
// long one and read as a layout bug.
//
// The wording of each line comes from the message files, its price from the
// CRM catalog (audit LD-07, see src/lib/site-prices.ts): what the site shows
// is what reception bills. A line the clinic no longer offers is left off.
export function Services({ sheet }: { sheet: SitePriceSheet }) {
  const t = useTranslations("services");
  const locale = useLocale() === "uz" ? "uz" : "ru";

  const groups = PRICE_GROUPS.map((groupKey) => {
    const items = t.raw(`groups.${groupKey}.items`) as PriceItem[];
    const lines = items
      .map((item, i) => ({ item, prices: sheet.groups[groupKey][i] ?? null }))
      .filter(
        (l): l is { item: PriceItem; prices: number[] } => l.prices !== null,
      );
    return { groupKey, lines };
  }).filter((g) => g.lines.length > 0);

  // Nothing could be priced (catalog unreachable): no sheet rather than a
  // sheet of guesses.
  if (groups.length === 0) return null;

  return (
    <section id="services" className="scroll-mt-20 border-t border-border bg-[#f4f8fc] py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h2>
        {sheet.updatedAt ? (
          <p className="mt-2 text-lg text-muted-foreground">
            {t("subtitle", { date: formatDate(sheet.updatedAt, locale, "short") })}
          </p>
        ) : null}

        <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-border bg-white">
          {groups.map(({ groupKey, lines }, gi) => (
            <div key={groupKey}>
              <div
                className={
                  gi === 0
                    ? "border-b border-border bg-[#f4f8fc] px-6 py-3"
                    : "border-y border-border bg-[#f4f8fc] px-6 py-3"
                }
              >
                <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-primary">
                  {t(`groups.${groupKey}.title`)}
                </h3>
              </div>
              <div className="divide-y divide-border/60">
                {lines.map(({ item, prices }, i) => (
                  <div key={i} className="px-6 py-4">
                    <div className="flex items-baseline gap-3">
                      {/* The name may wrap; the price never does and
                          never leaves the sheet (on a phone a long name
                          used to push it past the right edge). */}
                      <span className="min-w-0 text-[16px] leading-snug text-foreground">
                        {item.name}
                      </span>
                      <span
                        aria-hidden
                        className="min-w-4 flex-1 -translate-y-1 border-b border-dotted border-foreground/25"
                      />
                      <span className="shrink-0 whitespace-nowrap text-[16px] font-bold tabular-nums text-foreground">
                        {prices.map(formatSumAmount).join(" / ")}{" "}
                        <span className="font-normal text-muted-foreground">
                          {t("sum")}
                        </span>
                      </span>
                    </div>
                    {item.note && (
                      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                        {item.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
