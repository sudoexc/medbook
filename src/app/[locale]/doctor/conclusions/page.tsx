import { Suspense } from "react";

import { ConclusionsList } from "./_components/conclusions-list";

export default function ConclusionsPage() {
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Заключения</h1>
          <p className="text-sm text-muted-foreground">
            Финализированные приёмы и активные черновики.
          </p>
        </div>
      </div>

      {/* ConclusionsList reads `?status=draft` via useSearchParams. */}
      <Suspense fallback={null}>
        <ConclusionsList />
      </Suspense>
    </div>
  );
}
