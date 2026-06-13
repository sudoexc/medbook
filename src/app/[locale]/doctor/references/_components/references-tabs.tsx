"use client";

import { useTranslations } from "next-intl";
import { PillIcon, StethoscopeIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { DrugBrowser } from "./drug-browser";
import { Icd10Browser } from "./icd10-browser";

export function ReferencesTabs() {
  const t = useTranslations("doctor.references");
  return (
    <Tabs defaultValue="diseases" className="gap-4">
      <TabsList>
        <TabsTrigger value="diseases">
          <StethoscopeIcon className="size-4" />
          {t("tabs.diseases")}
        </TabsTrigger>
        <TabsTrigger value="drugs">
          <PillIcon className="size-4" />
          {t("tabs.drugs")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="diseases">
        <Icd10Browser />
      </TabsContent>
      <TabsContent value="drugs">
        <DrugBrowser />
      </TabsContent>
    </Tabs>
  );
}
