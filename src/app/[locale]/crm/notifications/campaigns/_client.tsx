"use client";

import { useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";

import { useTemplates } from "../_hooks/use-templates";
import { CampaignsList } from "../_components/campaigns-list";
import { NotificationsSubNav } from "../_components/notifications-sub-nav";

export function CampaignsPageClient() {
  const t = useTranslations("notifications");
  const templatesQuery = useTemplates();
  const templates = templatesQuery.data?.rows ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <SectionHeader
            title={t("campaignsPage.title")}
            subtitle={t("campaignsPage.subtitle")}
          />
          <NotificationsSubNav active="campaigns" />
          <CampaignsList templates={templates} />
        </PageContainer>
      </div>
    </div>
  );
}
