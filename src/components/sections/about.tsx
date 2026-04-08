import { useTranslations } from "next-intl";
import { UserCheck, Cpu, HeartHandshake, Wallet } from "lucide-react";

const items = [
  { icon: UserCheck, key: "experience" as const, color: "text-blue-600 bg-blue-50" },
  { icon: Cpu, key: "equipment" as const, color: "text-violet-600 bg-violet-50" },
  { icon: HeartHandshake, key: "approach" as const, color: "text-emerald-600 bg-emerald-50" },
  { icon: Wallet, key: "price" as const, color: "text-amber-600 bg-amber-50" },
];

export function About() {
  const t = useTranslations("about");

  return (
    <section id="about" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
          {t("title")}
        </h2>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.key}
              className="rounded-xl border border-border bg-white p-5"
            >
              <div className="flex gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.color}`}>
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
