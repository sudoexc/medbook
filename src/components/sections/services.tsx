import { useTranslations } from "next-intl";

type PriceItem = { name: string; price: string };

const GROUP_KEYS = ["consultations", "diagnostics"] as const;

export function Services() {
  const t = useTranslations("services");

  return (
    <section id="services" className="border-t border-border bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("title")}
        </h2>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
          {GROUP_KEYS.map((groupKey) => {
            const items = t.raw(`groups.${groupKey}.items`) as PriceItem[];
            return (
              <div
                key={groupKey}
                className="rounded-xl border border-border bg-white"
              >
                <div className="border-b border-border px-5 py-4">
                  <h3 className="font-semibold text-foreground">
                    {t(`groups.${groupKey}.title`)}
                  </h3>
                </div>
                <div className="divide-y divide-border">
                  {items.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-baseline justify-between gap-4 px-5 py-3"
                    >
                      <span className="text-sm text-foreground">{item.name}</span>
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
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
