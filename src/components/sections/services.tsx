import { useTranslations, useLocale } from "next-intl";
import { Brain, HeartPulse, Monitor, Baby } from "lucide-react";
import type { Locale } from "@/types";
import type { DoctorView } from "@/lib/doctors";

function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU").replace(/,/g, " ");
}

interface ServiceGroup {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  services: { name: Record<Locale, string>; price: number }[];
}

function getServiceGroups(doctors: DoctorView[]): ServiceGroup[] {
  const neuroServices = new Map<string, { name: Record<Locale, string>; price: number }>();
  const cardioServices = new Map<string, { name: Record<Locale, string>; price: number }>();
  const diagServices = new Map<string, { name: Record<Locale, string>; price: number }>();
  const pedServices = new Map<string, { name: Record<Locale, string>; price: number }>();

  for (const doc of doctors) {
    const spec = doc.specialty.ru;
    for (const svc of doc.services) {
      const key = svc.name.ru + svc.price;
      if (spec.includes("невролог") && !spec.includes("Детский")) {
        neuroServices.set(key, svc);
      } else if (spec.includes("Кардиолог")) {
        cardioServices.set(key, svc);
      } else if (spec.includes("УЗИ")) {
        diagServices.set(key, svc);
      } else if (spec.includes("Детский")) {
        pedServices.set(key, svc);
      }
    }
  }

  return [
    { key: "neurology", icon: Brain, color: "text-blue-600 bg-blue-50", services: [...neuroServices.values()] },
    { key: "cardiology", icon: HeartPulse, color: "text-rose-600 bg-rose-50", services: [...cardioServices.values()] },
    { key: "diagnostics", icon: Monitor, color: "text-violet-600 bg-violet-50", services: [...diagServices.values()] },
    { key: "pediatrics", icon: Baby, color: "text-emerald-600 bg-emerald-50", services: [...pedServices.values()] },
  ];
}

export function Services({ doctors }: { doctors: DoctorView[] }) {
  const t = useTranslations("services");
  const tDoc = useTranslations("doctors");
  const locale = useLocale() as Locale;
  const groups = getServiceGroups(doctors);

  return (
    <section id="services" className="py-16 sm:py-20 bg-[#f8f9fa]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
          {t("title")}
        </h2>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {groups.map((group) => (
            <div key={group.key} className="rounded-xl border border-border bg-white overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${group.color}`}>
                  <group.icon className="h-4 w-4" />
                </div>
                <h3 className="font-semibold text-foreground">
                  {t(group.key as "neurology" | "cardiology" | "diagnostics" | "pediatrics")}
                </h3>
              </div>
              <div className="divide-y divide-border">
                {group.services.map((svc, si) => (
                  <div key={si} className="flex items-center justify-between px-5 py-3">
                    <span className="text-sm text-foreground">{svc.name[locale]}</span>
                    <span className="text-sm font-medium tabular-nums whitespace-nowrap ml-4">
                      {formatPrice(svc.price)} <span className="text-muted-foreground font-normal">{tDoc("sum")}</span>
                    </span>
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
