"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface UsageRow {
  clinicId: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  active: boolean;
  appointments: number;
  smsSent: number;
  tgMessages: number;
  calls: number;
  patients: number;
}

interface UsageResp {
  from: string;
  to: string;
  period: "week" | "month";
  rows: UsageRow[];
  totals: {
    appointments: number;
    smsSent: number;
    tgMessages: number;
    calls: number;
    patients: number;
  };
}

async function fetchUsage(period: "week" | "month"): Promise<UsageResp> {
  const r = await fetch(`/api/platform/usage?period=${period}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as UsageResp;
}

export function UsagePageClient() {
  const [period, setPeriod] = React.useState<"week" | "month">("month");
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "usage", period],
    queryFn: () => fetchUsage(period),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Использование
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {new Date(data.from).toLocaleDateString()} —{" "}
              {new Date(data.to).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
          <Button
            size="sm"
            variant={period === "week" ? "default" : "ghost"}
            onClick={() => setPeriod("week")}
          >
            Неделя
          </Button>
          <Button
            size="sm"
            variant={period === "month" ? "default" : "ghost"}
            onClick={() => setPeriod("month")}
          >
            Месяц
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Загрузка…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Error"}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Kpi label="Записи" value={data.totals.appointments} />
            <Kpi label="SMS" value={data.totals.smsSent} />
            <Kpi label="TG сообщения" value={data.totals.tgMessages} />
            <Kpi label="Звонки" value={data.totals.calls} />
            <Kpi label="Новые пациенты" value={data.totals.patients} />
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="p-3 font-medium">Клиника</th>
                  <th className="p-3 font-medium text-right">Записи</th>
                  <th className="p-3 font-medium text-right">SMS</th>
                  <th className="p-3 font-medium text-right">TG</th>
                  <th className="p-3 font-medium text-right">Звонки</th>
                  <th className="p-3 font-medium text-right">Пациенты</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.clinicId}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.nameRu}</span>
                        {!r.active && <Badge variant="destructive">off</Badge>}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        /{r.slug}
                      </div>
                    </td>
                    <td className="p-3 text-right tabular-nums">
                      {r.appointments}
                    </td>
                    <td className="p-3 text-right tabular-nums">{r.smsSent}</td>
                    <td className="p-3 text-right tabular-nums">
                      {r.tgMessages}
                    </td>
                    <td className="p-3 text-right tabular-nums">{r.calls}</td>
                    <td className="p-3 text-right tabular-nums">{r.patients}</td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-8 text-center text-muted-foreground"
                    >
                      Нет клиник
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {value.toLocaleString("ru-RU")}
      </div>
    </div>
  );
}
