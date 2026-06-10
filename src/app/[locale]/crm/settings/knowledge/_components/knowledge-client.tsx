"use client";

/**
 * Ф4 — /crm/settings/knowledge. ADMIN curates what doctors see in the
 * ordering drawers: hide globals, patch them per-clinic (overlay) or add
 * clinic-local rows. Four tabs = the four knowledge catalogs.
 */
import { useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DrugsTab } from "./drugs-tab";
import { GuidesTab } from "./guides-tab";
import { HandoutsTab } from "./handouts-tab";
import { ProtocolsTab } from "./protocols-tab";

export function KnowledgeClient() {
  const t = useTranslations("settings.knowledge");

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />

      <Tabs defaultValue="drugs">
        <TabsList>
          <TabsTrigger value="drugs">{t("tabs.drugs")}</TabsTrigger>
          <TabsTrigger value="guides">{t("tabs.guides")}</TabsTrigger>
          <TabsTrigger value="protocols">{t("tabs.protocols")}</TabsTrigger>
          <TabsTrigger value="handouts">{t("tabs.handouts")}</TabsTrigger>
        </TabsList>
        <TabsContent value="drugs" className="pt-3">
          <DrugsTab />
        </TabsContent>
        <TabsContent value="guides" className="pt-3">
          <GuidesTab />
        </TabsContent>
        <TabsContent value="protocols" className="pt-3">
          <ProtocolsTab />
        </TabsContent>
        <TabsContent value="handouts" className="pt-3">
          <HandoutsTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
