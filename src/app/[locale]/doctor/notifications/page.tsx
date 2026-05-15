import { Suspense } from "react";

import { NotificationsList } from "./_components/notifications-list";

export default function NotificationsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Уведомления</h1>
          <p className="text-sm text-muted-foreground">
            Напоминания и задачи: то, что нужно сделать сегодня и позже.
          </p>
        </div>
      </div>

      {/* NotificationsList reads `?tab=` via useSearchParams. */}
      <Suspense fallback={null}>
        <NotificationsList />
      </Suspense>
    </div>
  );
}
