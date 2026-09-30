"use client";

/**
 * Client-side hook for async CSV export jobs.
 *
 *   const { start, status } = useAsyncExport();
 *   start({ kind: 'patients', filters: { ... } });
 *
 * Polls `/api/crm/exports/:jobId` every 1.5s until `done|failed`. On done,
 * triggers an anchor click on `/api/crm/exports/:jobId/download`.
 *
 * Every answer of the API ends in a status the button shows (audit AN-27).
 * The enqueue's 403 used to be swallowed after the button had already said
 * «поставлено в очередь», and a poll answering 404 (the in-memory job
 * registry is lost on a restart) kept the spinner going forever. Now:
 *   - `error` is a short code: `forbidden` (403), `lost` (the job is gone),
 *     `timeout` (not ready after `EXPORT_POLL_TIMEOUT_MS`), or the job's own
 *     error text;
 *   - `useAsyncExportToasts` turns the status into one toast per step.
 */
import * as React from "react";
import { useTranslations } from "next-intl";

import { toast } from "@/components/ui/sonner";

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

const EXPORT_POLL_MS = 1500;
/** A job not done by then is given up on, with a visible message. */
export const EXPORT_POLL_TIMEOUT_MS = 3 * 60_000;

/** The error code for a non-OK answer of the export API. */
export function exportErrorCode(status: number, fallback: string): string {
  if (status === 403) return "forbidden";
  if (status === 404) return "lost";
  return fallback;
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

  const fail = React.useCallback(
    (code: string) => {
      cleanupPoll();
      setStatus("failed");
      setError(code);
    },
    [cleanupPoll],
  );

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
          fail(exportErrorCode(res.status, `HTTP ${res.status}`));
          return;
        }
        const body = (await res.json()) as { jobId: string };
        setJobId(body.jobId);
        setStatus("running");
        const startedAt = Date.now();

        pollRef.current = setInterval(async () => {
          if (Date.now() - startedAt > EXPORT_POLL_TIMEOUT_MS) {
            fail("timeout");
            return;
          }
          try {
            const r = await fetch(`/api/crm/exports/${body.jobId}`, {
              credentials: "include",
            });
            if (r.status === 403 || r.status === 404) {
              fail(exportErrorCode(r.status, ""));
              return;
            }
            // A 5xx or a dropped connection: the next tick retries, the
            // timeout above ends it.
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
              fail(j.error ?? "export failed");
            }
          } catch {
            // swallow — next tick will retry
          }
        }, EXPORT_POLL_MS);
      } catch (e) {
        fail((e as Error).message);
      }
    },
    [cleanupPoll, fail],
  );

  return { start, status, jobId, error };
}

/**
 * One toast per step of an export: accepted, ready, or why it failed. The
 * accepted toast waits for the API's answer instead of firing on the click.
 */
export function useAsyncExportToasts(
  status: AsyncExportStatus,
  error: string | null,
): void {
  const tx = useTranslations("exportsUi");
  const prev = React.useRef<AsyncExportStatus>(status);
  React.useEffect(() => {
    if (prev.current === status) return;
    prev.current = status;
    if (status === "running") toast.message(tx("enqueued"));
    else if (status === "done") toast.success(tx("done"));
    else if (status === "failed") {
      toast.error(
        error === "forbidden"
          ? tx("forbidden")
          : error === "lost"
            ? tx("lost")
            : error === "timeout"
              ? tx("timeout")
              : tx("failedReason", { reason: error ?? "" }),
      );
    }
  }, [status, error, tx]);
}
