import { useTranslations } from "next-intl";

const STEPS = ["s1", "s2", "s3", "s4"] as const;

// What actually happens at the clinic, step by step. Every claim here is a
// real feature of the visit flow (walk-in live queue, hall queue TV, in-house
// diagnostics, conclusion delivered to Telegram) — this section replaces the
// generic "почему выбирают нас" marketing that said nothing.
export function Visit() {
  const t = useTranslations("visit");

  return (
    <section id="visit" className="border-t border-border bg-[#f4f8fc] py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {t("title")}
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((key, i) => (
            <div key={key} className="bg-white p-6 sm:p-7">
              <span className="text-sm font-bold tabular-nums text-primary">
                0{i + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold leading-snug text-foreground">
                {t(`${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`${key}.text`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
