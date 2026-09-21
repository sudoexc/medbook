import { useTranslations } from "next-intl";

type PriceItem = { name: string; note?: string; price: string };

const GROUP_KEYS = ["consultations", "diagnostics"] as const;

// The price list rendered like the printed прейскурант on the clinic door:
// plain ruled rows, group headers in small caps, prices right-aligned in
// tabular figures. No cards, no chrome — a document people trust.
export function Services() {
  const t = useTranslations("services");

  return (
    <section id="services" className="border-t border-border py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h2>
        <p className="mt-2 text-lg text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-10 grid grid-cols-1 gap-x-16 gap-y-12 lg:grid-cols-2">
          {GROUP_KEYS.map((groupKey) => {
            const items = t.raw(`groups.${groupKey}.items`) as PriceItem[];
            return (
              <div key={groupKey}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-primary">
                  {t(`groups.${groupKey}.title`)}
                </h3>
                <div className="mt-4 divide-y divide-border border-t border-border">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-baseline justify-between gap-6 py-4"
                    >
                      <span className="min-w-0">
                        <span className="block text-[17px] leading-snug text-foreground">
                          {item.name}
                        </span>
                        {item.note && (
                          <span className="mt-0.5 block text-sm text-muted-foreground">
                            {item.note}
                          </span>
                        )}
                      </span>
                      <span className="whitespace-nowrap text-[17px] font-bold tabular-nums text-foreground">
                        {item.price}{" "}
                        <span className="font-normal text-muted-foreground">
                          {t("sum")}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
