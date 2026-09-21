import { useTranslations } from "next-intl";

type PriceItem = { name: string; note?: string; price: string };

const GROUP_KEYS = ["consultations", "diagnostics"] as const;

// The price list as one printed «прейскурант» sheet: a single bordered
// paper, group headers as full-width bands, and a dotted leader tying each
// name to its price — the classic device that keeps the eye on the line.
// The previous two-column layout collapsed into a short column next to a
// long one and read as a layout bug.
export function Services() {
  const t = useTranslations("services");

  return (
    <section id="services" className="border-t border-border bg-[#f4f8fc] py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h2>
        <p className="mt-2 text-lg text-muted-foreground">{t("subtitle")}</p>

        <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-2xl border border-border bg-white">
          {GROUP_KEYS.map((groupKey, gi) => {
            const items = t.raw(`groups.${groupKey}.items`) as PriceItem[];
            return (
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
                  {items.map((item, i) => (
                    <div key={i} className="px-6 py-4">
                      <div className="flex items-baseline gap-3">
                        <span className="max-w-[70%] shrink-0 text-[16px] leading-snug text-foreground">
                          {item.name}
                        </span>
                        <span
                          aria-hidden
                          className="flex-1 -translate-y-1 border-b border-dotted border-foreground/25"
                        />
                        <span className="shrink-0 whitespace-nowrap text-[16px] font-bold tabular-nums text-foreground">
                          {item.price}{" "}
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
            );
          })}
        </div>
      </div>
    </section>
  );
}
