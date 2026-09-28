/**
 * `/tv` and `/tv/d/<token>` live outside the [locale] segment, so no
 * next-intl provider reaches them. The boards speak both languages at once
 * (audit UX-06): this layout ships the `tvBoard` namespace of Russian and
 * Uzbek, and nothing else of the bundles, to the TV provider.
 */
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

import { TvI18nProvider } from "./_i18n";

export default function TvLayout({ children }: { children: React.ReactNode }) {
  return (
    <TvI18nProvider messages={{ ru: ru.tvBoard, uz: uz.tvBoard }}>
      {children}
    </TvI18nProvider>
  );
}
