import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { SettingsTabs } from "./_components/settings-tabs";

export default async function SettingsPage() {
  const t = await getTranslations("doctor.settings");
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <SettingsTabs />
      </Suspense>
    </div>
  );
}
