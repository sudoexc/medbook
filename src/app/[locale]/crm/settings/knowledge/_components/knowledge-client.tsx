"use client";

/**
 * Ф4 — /crm/settings/knowledge. ADMIN curates what doctors see in the
 * ordering drawers: hide globals, patch them per-clinic (overlay) or add
 * clinic-local rows. Three tabs = the three knowledge catalogs a doctor
 * reaches from the visit screen, plus the diagnosis wordings the clinic
 * learned from practice (audit CT-05).
 *
 * No «Памятки» tab (audit G4-04): the visit screen lost its handout picker
 * long ago, and the patient handout is composed from the visit's own fields
 * (handout-composer), so a handout an admin wrote here reached no patient
 * while the tab made the feature look alive. The rows and the catalog route
 * stay; the tab comes back together with a picker on the visit screen.
 */
import { useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DiagnosesTab } from "./diagnoses-tab";
import { DrugsTab } from "./drugs-tab";
import { GuidesTab } from "./guides-tab";
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
          <TabsTrigger value="diagnoses">{t("tabs.diagnoses")}</TabsTrigger>
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
        <TabsContent value="diagnoses" className="pt-3">
          <DiagnosesTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}
