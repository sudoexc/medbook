"use client";

/**
 * Client-side hook for async CSV export jobs.
 *
 *   const { start, status } = useAsyncExport();
 *   start({ kind: 'patients', filters: { ... } });
 *
 * Polls `/api/crm/exports/:jobId` every 1.5s until `done|failed`. On done,
 * triggers an anchor click on `/api/crm/exports/:jobId/download`.
 */
import * as React from "react";

export type AsyncExportKind = "patients" | "appointments" | "payments";

export type AsyncExportStatus =
  | "idle"
  | "enqueued"
  | "running"
  | "done"
  | "failed";

export interface AsyncExportStartArgs {
  kind: AsyncExportKind;
  filters?: Record<string, unknown>;
}

export function useAsyncExport() {
  const [status, setStatus] = React.useState<AsyncExportStatus>("idle");
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanupPoll = React.useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  React.useEffect(() => cleanupPoll, [cleanupPoll]);

  const start = React.useCallback(
    async (args: AsyncExportStartArgs) => {
      cleanupPoll();
      setError(null);
      setStatus("enqueued");
      setJobId(null);
      try {
        const res = await fetch("/api/crm/exports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            kind: args.kind,
            filters: args.filters ?? {},
          }),
        });
        if (!res.ok) {
          setStatus("failed");
          setError(`enqueue ${res.status}`);
          return;
        }
        const body = (await res.json()) as { jobId: string };
        setJobId(body.jobId);
        setStatus("running");

        pollRef.current = setInterval(async () => {
          try {
            const r = await fetch(`/api/crm/exports/${body.jobId}`, {
              credentials: "include",
            });
            if (!r.ok) return;
            const j = (await r.json()) as {
              status: AsyncExportStatus;
              downloadUrl: string | null;
              error: string | null;
            };
            if (j.status === "done" && j.downloadUrl) {
              setStatus("done");
              cleanupPoll();
              // Trigger download via hidden anchor.
              const a = document.createElement("a");
              a.href = j.downloadUrl;
              a.download = "";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            } else if (j.status === "failed") {
              setStatus("failed");
              setError(j.error ?? "export failed");
              cleanupPoll();
            }
          } catch {
            // swallow — next tick will retry
          }
        }, 1500);
      } catch (e) {
        setStatus("failed");
        setError((e as Error).message);
      }
    },
    [cleanupPoll],
  );

  return { start, status, jobId, error };
}
