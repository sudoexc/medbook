"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CoffeeIcon, PlayIcon, UtensilsIcon } from "lucide-react";

import type { DoctorPauseKind, DoctorPauseView } from "@/lib/doctor-pause";

const KEY = ["doctor-pause"] as const;

async function send<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function since(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  });
}

/**
 * «Перерыв» and «Обед» in the doctor's top bar (owner request 09.10.2026):
 * one press any time, and his TV shows «Врач на перерыве» / «Врач на обеде»
 * instead of the queue. While paused, one button: «Закончить», after which
 * the TV says «Врач снова принимает» and shows the queue again.
 */
export function DoctorPauseButtons() {
  const t = useTranslations("doctorPause");
  const qc = useQueryClient();
  const query = useQuery<DoctorPauseView | null, Error>({
    queryKey: KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/doctor-pause", { credentials: "include", signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return ((await res.json()) as { pause: DoctorPauseView | null }).pause;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const start = useMutation<{ pause: DoctorPauseView | null }, Error, DoctorPauseKind>({
    mutationFn: (kind) => send("/api/crm/doctor-pause", { kind }),
    onSuccess: (r) => qc.setQueryData(KEY, r.pause),
    onError: () => toast.error(t("failed")),
  });
  const end = useMutation<{ pause: null }, Error, void>({
    mutationFn: () => send("/api/crm/doctor-pause/end"),
    onSuccess: () => {
      qc.setQueryData(KEY, null);
      toast.success(t("resumedToast"));
    },
    onError: () => toast.error(t("failed")),
  });
  const pause = query.data ?? null;
  const busy = start.isPending || end.isPending;

  if (pause) {
    return (
      <button
        type="button"
        onClick={() => end.mutate()}
        disabled={busy}
        className="motion-press inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl border-2 border-info bg-info/15 px-3.5 text-sm font-semibold text-foreground"
      >
        <PlayIcon className="size-4 text-info" />
        <span>
          {pause.kind === "LUNCH" ? t("endLunch") : t("endBreak")}
          <span className="ml-1.5 hidden font-normal text-muted-foreground xl:inline">
            {t("since", { time: since(pause.startedAt) })}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="inline-flex shrink-0 items-center gap-1">
      {(
        [
          ["BREAK", CoffeeIcon, t("break")],
          ["LUNCH", UtensilsIcon, t("lunch")],
        ] as const
      ).map(([kind, Icon, label]) => (
        <button
          key={kind}
          type="button"
          onClick={() => start.mutate(kind)}
          disabled={busy || query.isLoading}
          title={label}
          className="motion-press inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          <Icon className="size-4 text-muted-foreground" />
          <span className="hidden xl:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}
