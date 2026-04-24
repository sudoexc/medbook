"use client";

import { useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";

import { TriggersPanel } from "../_components/triggers-panel";
import { NotificationsSubNav } from "../_components/notifications-sub-nav";

export function TriggersPageClient() {
  const t = useTranslations("notifications");

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <SectionHeader
            title={t("triggersPage.title")}
            subtitle={t("triggersPage.subtitle")}
          />
          <NotificationsSubNav active="triggers" />
          <TriggersPanel />
        </PageContainer>
      </div>
    </div>
  );
}
