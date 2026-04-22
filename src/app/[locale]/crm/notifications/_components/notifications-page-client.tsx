"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { useTemplates } from "../_hooks/use-templates";
import { TemplateTree } from "./template-tree";
import { TemplateEditor } from "./template-editor";
import { QueueTable } from "./queue-table";
import { CampaignsList } from "./campaigns-list";
import { TriggersPanel } from "./triggers-panel";
import { NotificationsStatsRail } from "./notifications-stats-rail";

type TopTab = "templates" | "queue" | "campaigns" | "triggers";
const TABS: TopTab[] = ["templates", "queue", "campaigns", "triggers"];

function isTopTab(v: string | null | undefined): v is TopTab {
  return v !== null && v !== undefined && (TABS as string[]).includes(v);
}

export function NotificationsPageClient() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = searchParams?.get("tab");
  const tab: TopTab = isTopTab(tabParam) ? tabParam : "templates";
  const selectedTemplateId = searchParams?.get("tpl") ?? null;

  const setTab = (next: TopTab) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.set("tab", next);
    router.replace(`?${sp.toString()}`, { scroll: false });
  };
  const setSelectedTemplate = (id: string | null) => {
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (id) sp.set("tpl", id);
    else sp.delete("tpl");
    router.replace(`?${sp.toString()}`, { scroll: false });
  };

  const templatesQuery = useTemplates();
  const templates = templatesQuery.data?.rows ?? [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <SectionHeader title={t("title")} subtitle={t("subtitle")} />

          <Tabs value={tab} onValueChange={(v) => setTab(v as TopTab)}>
            <TabsList>
              <TabsTrigger value="templates">{t("tabs.templates")}</TabsTrigger>
              <TabsTrigger value="queue">{t("tabs.queue")}</TabsTrigger>
              <TabsTrigger value="campaigns">{t("tabs.campaigns")}</TabsTrigger>
              <TabsTrigger value="triggers">{t("tabs.triggers")}</TabsTrigger>
            </TabsList>

            <TabsContent value="templates">
              <div className="grid min-h-[65vh] grid-cols-1 gap-3 xl:grid-cols-[280px,1fr]">
                <TemplateTree
                  templates={templates}
                  selectedId={selectedTemplateId}
                  onSelect={setSelectedTemplate}
                  isLoading={templatesQuery.isLoading}
                />
                <TemplateEditor
                  templates={templates}
                  selectedId={selectedTemplateId}
                  onSelectCreated={setSelectedTemplate}
                />
              </div>
            </TabsContent>

            <TabsContent value="queue">
              <QueueTable />
            </TabsContent>

            <TabsContent value="campaigns">
              <CampaignsList templates={templates} />
            </TabsContent>

            <TabsContent value="triggers">
              <TriggersPanel />
            </TabsContent>
          </Tabs>
        </PageContainer>
      </div>

      <aside
        className="hidden w-[320px] shrink-0 flex-col border-l border-border bg-card p-4 xl:flex"
        aria-label={t("rail.title")}
      >
        <NotificationsStatsRail />
      </aside>
    </div>
  );
}
