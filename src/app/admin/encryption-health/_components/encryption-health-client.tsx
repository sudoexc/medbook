"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  CircleAlertIcon,
  KeyIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ColumnCounts {
  total: number;
  null: number;
  plaintext: number;
  byVersion: Record<string, number>;
}

interface HealthResponse {
  activeKeyVersion: string;
  knownVersions: string[];
  isDevFallback: boolean;
  probeOk: boolean;
  probeError: string | null;
  counts: Record<string, ColumnCounts>;
  generatedAt: string;
}

const COLUMN_LABELS: Record<string, string> = {
  "patient.passport": "Patient · паспорт",
  "patient.notes": "Patient · заметки",
  "medical_case.soapDraft": "MedicalCase · черновик SOAP",
  "prescription.notes": "Prescription · заметки",
};

async function fetchHealth(): Promise<HealthResponse> {
  const r = await fetch("/api/admin/encryption-health", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as HealthResponse;
}

export function EncryptionHealthClient() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "encryption-health"],
    queryFn: fetchHealth,
    // Slower than the system-health tab — the SQL counts are real work and
    // posture doesn't change minute-to-minute. 60s is plenty.
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Шифрование данных
          </h1>
          <p className="text-sm text-muted-foreground">
            Состояние полевого шифрования (AES-256-GCM)
            {data && ` · обновлено ${new Date(data.generatedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCwIcon className={isFetching ? "animate-spin" : ""} />
          Обновить
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Загрузка…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Ошибка"}
        </div>
      )}

      {data && (
        <>
          <PostureCard data={data} />
          <CountsTable data={data} />
          <RunbookHint />
        </>
      )}
    </div>
  );
}

function PostureCard({ data }: { data: HealthResponse }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <KvCard
        icon={<ShieldCheckIcon className="size-5" />}
        label="Активный ключ"
        value={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {data.activeKeyVersion}
            </Badge>
            {data.isDevFallback && (
              <Badge variant="destructive" className="text-[10px]">
                DEV FALLBACK
              </Badge>
            )}
          </div>
        }
        hint={
          data.isDevFallback
            ? "Установлен dev-ключ — не для продакшена"
            : "Версия, под которой шифруются новые записи"
        }
      />
      <KvCard
        icon={<KeyIcon className="size-5" />}
        label="Доступные версии"
        value={
          <div className="flex flex-wrap gap-1">
            {data.knownVersions.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              data.knownVersions.map((v) => (
                <Badge
                  key={v}
                  variant={v === data.activeKeyVersion ? "default" : "outline"}
                  className="font-mono"
                >
                  {v}
                </Badge>
              ))
            )}
          </div>
        }
        hint="Все ключи, которые приложение умеет читать"
      />
      <KvCard
        icon={
          data.probeOk ? (
            <CheckCircle2Icon className="size-5 text-primary" />
          ) : (
            <XCircleIcon className="size-5 text-destructive" />
          )
        }
        label="Round-trip проба"
        value={
          <span
            className={
              data.probeOk
                ? "text-sm font-semibold text-primary"
                : "text-sm font-semibold text-destructive"
            }
          >
            {data.probeOk ? "OK" : "FAILED"}
          </span>
        }
        hint={
          data.probeOk
            ? "Активный ключ корректно шифрует и расшифровывает"
            : data.probeError ?? "Сбой round-trip"
        }
      />
    </div>
  );
}

function KvCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function CountsTable({ data }: { data: HealthResponse }) {
  const columns = Object.keys(data.counts);
  // Build the union of all version columns we need to display, sorted by
  // numeric suffix.
  const allVersions = new Set<string>();
  for (const c of columns) {
    for (const v of Object.keys(data.counts[c]!.byVersion)) {
      allVersions.add(v);
    }
  }
  const versionList = [...allVersions].sort(
    (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10),
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Распределение строк по версиям ключа
        </h2>
        <p className="text-xs text-muted-foreground">
          Чтобы безопасно убрать старый ключ — все колонки должны показывать
          его счётчик равным нулю.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2">Колонка</th>
              <th className="px-4 py-2 text-right">Всего</th>
              {versionList.map((v) => (
                <th key={v} className="px-4 py-2 text-right font-mono">
                  {v}
                </th>
              ))}
              <th className="px-4 py-2 text-right">plaintext</th>
              <th className="px-4 py-2 text-right">null</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col) => {
              const c = data.counts[col]!;
              const hasPlaintext = c.plaintext > 0;
              return (
                <tr key={col} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-medium text-foreground">
                    {COLUMN_LABELS[col] ?? col}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {c.total}
                  </td>
                  {versionList.map((v) => {
                    const n = c.byVersion[v] ?? 0;
                    const isActive = v === data.activeKeyVersion;
                    return (
                      <td
                        key={v}
                        className={
                          "px-4 py-2 text-right font-mono " +
                          (isActive
                            ? "text-primary"
                            : n > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground")
                        }
                      >
                        {n}
                      </td>
                    );
                  })}
                  <td
                    className={
                      "px-4 py-2 text-right font-mono " +
                      (hasPlaintext
                        ? "text-destructive"
                        : "text-muted-foreground")
                    }
                  >
                    {c.plaintext}
                    {hasPlaintext && (
                      <CircleAlertIcon className="ml-1 inline size-3 text-destructive" />
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                    {c.null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunbookHint() {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
      <div className="font-semibold text-foreground">Подсказка</div>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>
          Если есть строки <code>plaintext</code> &gt; 0 — запустите
          {" "}
          <code className="rounded bg-muted px-1">
            tsx scripts/encrypt-existing-pii.ts
          </code>
          .
        </li>
        <li>
          Чтобы добавить новый ключ и переключиться на него — следуйте
          {" "}
          <code className="rounded bg-muted px-1">
            docs/runbooks/encryption-key-rotation.md
          </code>
          .
        </li>
        <li>
          После добавления <code>FIELD_ENCRYPTION_KEY_V2</code> запустите
          {" "}
          <code className="rounded bg-muted px-1">
            tsx scripts/rotate-encryption-key.ts
          </code>{" "}
          и убедитесь, что счётчик старой версии стал 0.
        </li>
      </ul>
    </div>
  );
}
