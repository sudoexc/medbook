"use client";

import { useQuery } from "@tanstack/react-query";
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

function formatSize(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
}

export function RecentFilesCard() {
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
          Недавние файлы
        </h3>
      </header>

      {!patientId ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Выберите пациента.
        </p>
      ) : q.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Загружаем…
        </p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          Файлов нет.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((f) => (
            <li
              key={f.id}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"
            >
              <span className="inline-flex size-8 items-center justify-center rounded-lg bg-info/10 text-info">
                <FileIcon className="size-4" />
              </span>
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
                  {f.fileSize ? `, ${formatSize(f.fileSize)}` : ""}
                </div>
              </div>
              {f.fileUrl ? (
                <a
                  href={f.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Скачать"
                  className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <DownloadIcon className="size-4" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
