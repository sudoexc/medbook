import { Suspense } from "react";

import { SettingsTabs } from "./_components/settings-tabs";

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Настройки</h1>
          <p className="text-sm text-muted-foreground">
            Личные данные, подпись для PDF, каналы уведомлений и статус
            безопасности.
          </p>
        </div>
      </div>

      <Suspense fallback={null}>
        <SettingsTabs />
      </Suspense>
    </div>
  );
}
