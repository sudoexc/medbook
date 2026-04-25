"use client";

import * as React from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AuditRow {
  id: string;
  clinicId: string | null;
  actorId: string | null;
  actorRole: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: unknown;
  ip: string | null;
  createdAt: string;
  clinic: { id: string; slug: string; nameRu: string } | null;
  actor: { id: string; name: string; email: string } | null;
}

interface AuditResp {
  rows: AuditRow[];
  nextCursor: string | null;
}

interface ClinicOption {
  id: string;
  slug: string;
  nameRu: string;
}

async function fetchAudit(
  params: URLSearchParams,
): Promise<AuditResp> {
  const r = await fetch(`/api/platform/audit?${params.toString()}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as AuditResp;
}

async function fetchClinics(): Promise<ClinicOption[]> {
  const r = await fetch("/api/platform/clinics", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { clinics: ClinicOption[] };
  return data.clinics;
}

export function AuditPageClient() {
  const [clinicId, setClinicId] = React.useState("");
  const [entityType, setEntityType] = React.useState("");
  const [action, setAction] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");

  const clinics = useQuery({
    queryKey: ["admin", "clinics", "options"],
    queryFn: fetchClinics,
  });

  const audit = useInfiniteQuery({
    queryKey: ["admin", "audit", clinicId, entityType, action, from, to],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const p = new URLSearchParams();
      if (clinicId) p.set("clinicId", clinicId);
      if (entityType) p.set("entityType", entityType);
      if (action) p.set("action", action);
      if (from) p.set("from", new Date(from).toISOString());
      if (to) p.set("to", new Date(to).toISOString());
      if (pageParam) p.set("cursor", String(pageParam));
      return fetchAudit(p);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const allRows = React.useMemo(
    () => audit.data?.pages.flatMap((p) => p.rows) ?? [],
    [audit.data],
  );

  return (
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <Select value={clinicId} onValueChange={setClinicId}>
          <SelectTrigger>
            <SelectValue placeholder="Все клиники" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Все клиники</SelectItem>
            {clinics.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nameRu}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="entityType"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
        />
        <Input
          placeholder="action (contains)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {audit.isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Загрузка…
        </div>
      )}
      {audit.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {audit.error instanceof Error ? audit.error.message : "Error"}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left">
              <th className="p-3 font-medium">Время</th>
              <th className="p-3 font-medium">Клиника</th>
              <th className="p-3 font-medium">Actor</th>
              <th className="p-3 font-medium">Action</th>
              <th className="p-3 font-medium">Entity</th>
              <th className="p-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="p-3 font-mono text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="p-3 text-xs">
                  {r.clinic ? (
                    <span className="text-foreground">{r.clinic.nameRu}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-3 text-xs">
                  {r.actor ? (
                    <span>
                      <span className="font-medium">{r.actor.name}</span>{" "}
                      <Badge variant="secondary">{r.actorRole}</Badge>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {r.actorLabel ?? "system"}
                    </span>
                  )}
                </td>
                <td className="p-3 font-mono text-xs">{r.action}</td>
                <td className="p-3 text-xs">
                  <div>{r.entityType}</div>
                  {r.entityId && (
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {r.entityId}
                    </div>
                  )}
                </td>
                <td className="p-3 font-mono text-[11px] text-muted-foreground">
                  {r.ip ?? "—"}
                </td>
              </tr>
            ))}
            {!allRows.length && !audit.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-muted-foreground"
                >
                  Нет записей
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {audit.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => audit.fetchNextPage()}
            disabled={audit.isFetchingNextPage}
          >
            {audit.isFetchingNextPage ? "Загрузка…" : "Показать ещё"}
          </Button>
        </div>
      )}
    </div>
  );
}
