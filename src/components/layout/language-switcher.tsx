"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchTo = locale === "ru" ? "uz" : "ru";
  const label = locale === "ru" ? "O'z" : "Рус";

  function handleSwitch() {
    router.replace(pathname, { locale: switchTo });
  }

  return (
    <button
      onClick={handleSwitch}
      className="flex items-center gap-2 rounded-xl border border-border/60 bg-foreground/[0.03] px-3.5 py-2 text-sm font-medium transition-all hover:bg-foreground/[0.06] hover:border-border"
    >
      <Globe className="h-4 w-4 text-muted-foreground" />
      <span>{label}</span>
    </button>
  );
}
