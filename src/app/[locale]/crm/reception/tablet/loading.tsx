/**
 * Route skeleton of the reception tablet: the same full-screen frame, top
 * bar, tiles and bottom actions as the page, so nothing jumps when the data
 * lands (the desktop reception's skeleton would flash its sidebar layout).
 */
export default function ReceptionTabletLoading() {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-surface" aria-busy="true">
      <div className="flex h-[4.5rem] shrink-0 items-center gap-4 border-b border-border bg-card px-6">
        <div className="size-12 animate-pulse rounded-2xl bg-muted" />
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-14 w-48 animate-pulse rounded-2xl bg-muted" />
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-hidden px-6 py-6 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[19rem] animate-pulse rounded-3xl bg-muted" />
        ))}
      </div>
      <div className="flex shrink-0 gap-4 border-t border-border bg-card px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="h-24 flex-[3] animate-pulse rounded-3xl bg-muted" />
        <div className="h-24 flex-[2] animate-pulse rounded-3xl bg-muted" />
      </div>
    </div>
  );
}
