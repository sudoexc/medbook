"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DownloadIcon, FileIcon } from "lucide-react";

import { useReceptionContext } from "../_hooks/reception-context";

type DocRow = {
  id: string;
  title: string;
  type: string;
  fileSize: number | null;
  fileUrl: string | null;
  createdAt: string;
};

function formatSize(b: number | null, t: (key: string, values?: Record<string, string | number>) => string): string {
  if (!b) return "—";
  if (b < 1024) return t("recentFiles.sizeBytes", { value: b });
  if (b < 1024 * 1024)
    return t("recentFiles.sizeKb", { value: (b / 1024).toFixed(1) });
  if (b < 1024 * 1024 * 1024)
    return t("recentFiles.sizeMb", { value: (b / (1024 * 1024)).toFixed(1) });
  return t("recentFiles.sizeGb", { value: (b / (1024 * 1024 * 1024)).toFixed(1) });
}

/** Force a download for the local streaming route (?download=1) while leaving
 *  external/absolute URLs untouched. */
function downloadUrl(fileUrl: string): string {
  if (!fileUrl.startsWith("/")) return fileUrl;
  return fileUrl.includes("?")
    ? `${fileUrl}&download=1`
    : `${fileUrl}?download=1`;
}

export function RecentFilesCard() {
  const t = useTranslations("doctor.reception");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const { activeAppointment } = useReceptionContext();
  const patientId = activeAppointment?.patient.id ?? null;

  const q = useQuery({
    queryKey: ["doctor", "reception", "recent-files", patientId],
    enabled: !!patientId,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        patientId: patientId!,
        sort: "createdAt",
        dir: "desc",
        limit: "5",
      });
      const res = await fetch(`/api/crm/documents?${params.toString()}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`documents ${res.status}`);
      const data = (await res.json()) as { rows: DocRow[] };
      return data.rows;
    },
    staleTime: 30_000,
  });

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {t("recentFiles.title")}
        </h3>
      </header>

      {!patientId ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("recentFiles.selectPatient")}
        </p>
      ) : q.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("recentFiles.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                <FileIcon className="size-4" />
              </span>
              {f.fileUrl ? (
                <a
                  href={f.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1"
                >
                  <div className="truncate text-sm font-medium text-foreground hover:underline">
                    {f.title}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {new Date(f.createdAt).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                    {f.fileSize ? `, ${formatSize(f.fileSize, t)}` : ""}
                  </div>
                </a>
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {f.title}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {new Date(f.createdAt).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                    {f.fileSize ? `, ${formatSize(f.fileSize, t)}` : ""}
                  </div>
                </div>
              )}
              {f.fileUrl ? (
                <a
                  href={downloadUrl(f.fileUrl)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("recentFiles.download")}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <DownloadIcon className="size-4" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border px-4 py-2.5">
        <Link
          href={`/${locale}/doctor/documents`}
          className="text-xs font-medium text-primary hover:underline"
        >
          {t("recentFiles.openAll")}
        </Link>
      </div>
    </section>
  );
}
