import { useTranslations } from "next-intl";
import { UserCheck, Cpu, HeartHandshake, Wallet } from "lucide-react";

const items = [
  { icon: UserCheck, key: "experience" as const },
  { icon: Cpu, key: "equipment" as const },
  { icon: HeartHandshake, key: "approach" as const },
  { icon: Wallet, key: "price" as const },
];

export function About() {
  const t = useTranslations("about");

  return (
    <section id="about" className="border-t border-border py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("title")}
        </h2>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-xl border border-border bg-white p-5"
            >
              <div className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">{t(`${item.key}.title`)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                    {t(`${item.key}.description`)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
