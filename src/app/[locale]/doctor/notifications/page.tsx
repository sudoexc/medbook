import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { NotificationsList } from "./_components/notifications-list";

export default async function NotificationsPage() {
  const t = await getTranslations("doctor.notifications");
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </div>

      {/* NotificationsList reads `?tab=` via useSearchParams. */}
      <Suspense fallback={null}>
        <NotificationsList />
      </Suspense>
    </div>
  );
}
