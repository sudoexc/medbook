"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";

import { useTemplates } from "../_hooks/use-templates";
import { TemplateTree } from "../_components/template-tree";
import { TemplateEditor } from "../_components/template-editor";
import { NotificationsSubNav } from "../_components/notifications-sub-nav";

export function TemplatesPageClient() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedTemplateId = searchParams?.get("tpl") ?? null;

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
          <SectionHeader
            title={t("templatesPage.title")}
            subtitle={t("templatesPage.subtitle")}
          />
          <NotificationsSubNav active="templates" />
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
        </PageContainer>
      </div>
    </div>
  );
}
