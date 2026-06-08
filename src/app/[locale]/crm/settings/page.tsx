import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  BadgeCheckIcon,
  BellRingIcon,
  BuildingIcon,
  CoinsIcon,
  CreditCardIcon,
  DoorOpenIcon,
  FileTextIcon,
  GitBranchIcon,
  PaletteIcon,
  PlugZapIcon,
  ScrollIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";

interface CardSpec {
  /** Translation key under `settings.cards.{key}` (label + description). */
  key: string;
  /** Path appended to `/{locale}/crm` — may be a `settings/...` child or a
   * top-level CRM route (e.g. `rooms`, `services`, `documents`)
   * relocated out of the main sidebar in Phase 11. */
  path: string;
  icon: LucideIcon;
}

const CLINIC_MANAGEMENT: CardSpec[] = [
  { key: "roles", path: "settings/roles", icon: BadgeCheckIcon },
  { key: "cabinets", path: "rooms", icon: DoorOpenIcon },
  { key: "services", path: "services", icon: SparklesIcon },
  { key: "documents", path: "documents", icon: FileTextIcon },
  // SMS-Email tile removed in SMS removal Wave 2 (docs/TZ-sms-removal.md).
];

const CORE_SETTINGS: CardSpec[] = [
  { key: "clinic", path: "settings/clinic", icon: BuildingIcon },
  { key: "branches", path: "settings/branches", icon: GitBranchIcon },
  { key: "branding", path: "settings/branding", icon: PaletteIcon },
  { key: "users", path: "settings/users", icon: UsersIcon },
  { key: "exchangeRates", path: "settings/exchange-rates", icon: CoinsIcon },
  { key: "integrations", path: "settings/integrations", icon: PlugZapIcon },
  { key: "notifications", path: "settings/notifications", icon: BellRingIcon },
  { key: "billing", path: "settings/billing", icon: CreditCardIcon },
  { key: "audit", path: "settings/audit", icon: ScrollIcon },
  // Phase 17 Wave 3 — DSAR review queue.
  { key: "dsar", path: "settings/dsar", icon: ShieldCheckIcon },
];

function CardGrid({
  cards,
  locale,
  t,
}: {
  cards: CardSpec[];
  locale: string;
  t: (key: string) => string;
}) {
  return (
    <div className="motion-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.key}
            href={`/${locale}/crm/${card.path}`}
            className="motion-rise-in motion-hover-lift motion-press group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15">
              <Icon className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">
                {t(`settings.cards.${card.key}.title`)}
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {t(`settings.cards.${card.key}.description`)}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * /crm/settings — overview index. Up until Phase 11 this route just redirected
 * to `/crm/settings/clinic`. With the sidebar cleanup we now use it as a true
 * landing page where ADMIN can pivot into clinic management surfaces — both
 * the existing settings sub-routes and the operational pages (rooms / services
 * / documents) that were demoted from the main CRM sidebar.
 */
export default async function SettingsIndexPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale });

  return (
    <PageContainer>
      <SectionHeader
        title={t("settings.index.title")}
        subtitle={t("settings.index.subtitle")}
      />

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("settings.index.clinicManagement")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.index.clinicManagementHint")}
        </p>
        <div className="pt-1">
          <CardGrid cards={CLINIC_MANAGEMENT} locale={locale} t={t} />
        </div>
      </div>

      <div className="space-y-2 pt-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("settings.index.coreSettings")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t("settings.index.coreSettingsHint")}
        </p>
        <div className="pt-1">
          <CardGrid cards={CORE_SETTINGS} locale={locale} t={t} />
        </div>
      </div>
    </PageContainer>
  );
}
