"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PhoneIncomingIcon } from "lucide-react";

import type { CallRow } from "../_hooks/types";
import { CallBubble } from "./call-bubble";

/**
 * Left column — ringing queue.
 *
 * Shows every call that is still in-flight (direction=IN, endedAt=null).
 * New rows trigger a one-shot toast so the operator notices even if they're
 * looking at another column.
 *
 * Selection is URL-synced via `use-active-call.ts` — the page client owns the
 * `selectedId` + `onSelect` plumbing.
 */
export function IncomingQueue({
  rows,
  selectedId,
  onSelect,
  isLoading,
}: {
  rows: CallRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading?: boolean;
}) {
  const t = useTranslations("callCenter.queue");

  // Remember ids we've already shown a toast for so re-renders don't spam.
  const seenRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    for (const row of rows) {
      if (!seenRef.current.has(row.id)) {
        seenRef.current.add(row.id);
        // Only toast for the first *batch* beyond the initial load.
        if (seenRef.current.size > rows.length) {
          const name = row.patient?.fullName ?? t("unknownCaller");
          toast.info(t("newCallToast", { name, phone: row.fromNumber }));
        }
      }
    }
    // Prune ids that have left the queue so the set doesn't grow unbounded.
    const current = new Set(rows.map((r) => r.id));
    for (const id of seenRef.current) {
      if (!current.has(id)) seenRef.current.delete(id);
    }
  }, [rows, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <PhoneIncomingIcon className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">{t("title")}</h2>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {rows.length}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading && rows.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 py-8 text-center">
            <PhoneIncomingIcon className="size-8 text-muted-foreground/40" aria-hidden />
            <p className="text-xs text-muted-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="grid gap-1">
            {rows.map((row) => (
              <li key={row.id}>
                <CallBubble
                  row={row}
                  onClick={() => onSelect(row.id)}
                  selected={row.id === selectedId}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        {t("pollingHint")}
        {/* TODO(realtime-engineer): replace 5s polling with SSE on `call.incoming`. */}
      </footer>
    </div>
  );
}
