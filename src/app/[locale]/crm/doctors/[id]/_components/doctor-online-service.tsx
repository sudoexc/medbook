"use client";

/**
 * «Онлайн-запись» card on the doctor's «Услуги» tab (audit MA-08).
 *
 * The Mini App wizard never asks the patient for a service, so the clinic
 * names the one a booking with this doctor is made for. The card also says
 * what the Mini App does right now: books the picked service, books the
 * doctor's only active service, or leaves the doctor out of online booking
 * (several services and no pick, or none active).
 */
import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnlineServiceResolution } from "@/lib/doctors/online-service";

type LinkedService = { id: string; nameRu: string; nameUz: string; isActive: boolean };

type OnlineServiceState = {
  onlineServiceId: string | null;
  services: LinkedService[];
  resolution: OnlineServiceResolution;
};

const NONE = "__none";

// Under the services editor's key, so saving the doctor's services there
// (which invalidates ["doctor-services", id]) refreshes this card too.
const onlineServiceKey = (doctorId: string) =>
  ["doctor-services", doctorId, "online-service"] as const;

export function DoctorOnlineService({
  doctorId,
  canEdit,
  className,
}: {
  doctorId: string;
  canEdit: boolean;
  className?: string;
}) {
  const t = useTranslations("crmDoctors.onlineService");
  const locale = useLocale();
  const qc = useQueryClient();

  const query = useQuery<OnlineServiceState, Error>({
    queryKey: onlineServiceKey(doctorId),
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}/online-service`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OnlineServiceState;
    },
    staleTime: 30_000,
  });

  // A stored pick that is no longer an active link of the doctor is not
  // honoured by the Mini App; show it as «not chosen» so Save can clear it.
  const [picked, setPicked] = React.useState<string>(NONE);
  React.useEffect(() => {
    if (!query.data) return;
    const stored = query.data.onlineServiceId;
    const valid = query.data.services.some((s) => s.id === stored && s.isActive);
    setPicked(stored && valid ? stored : NONE);
  }, [query.data]);

  const save = useMutation<OnlineServiceState, Error, string | null>({
    mutationFn: async (serviceId) => {
      const res = await fetch(`/api/crm/doctors/${doctorId}/online-service`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OnlineServiceState;
    },
    onSuccess: (data) => {
      qc.setQueryData(onlineServiceKey(doctorId), data);
      toast.success(t("saved"));
    },
    onError: () => toast.error(t("saveFailed")),
  });

  const nameOf = (s: LinkedService) => (locale === "uz" ? s.nameUz : s.nameRu);
  const active = (query.data?.services ?? []).filter((s) => s.isActive);
  const resolution = query.data?.resolution;
  const resolvedName = (id: string) => {
    const s = query.data?.services.find((x) => x.id === id);
    return s ? nameOf(s) : "";
  };
  const status = !resolution
    ? null
    : resolution.kind === "chosen"
      ? { tone: "ok", text: t("statusChosen", { service: resolvedName(resolution.serviceId) }) }
      : resolution.kind === "only"
        ? { tone: "ok", text: t("statusOnly", { service: resolvedName(resolution.serviceId) }) }
        : resolution.kind === "ambiguous"
          ? { tone: "warn", text: t("statusAmbiguous") }
          : { tone: "warn", text: t("statusNone") };

  const dirty = (query.data?.onlineServiceId ?? NONE) !== picked;

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("hint")}</p>
      </div>

      {query.isLoading ? (
        <div className="h-9 animate-pulse rounded-md bg-muted" />
      ) : query.isError || !query.data ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {t("loadError")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor={`online-svc-${doctorId}`} className="text-xs text-muted-foreground">
                {t("label")}
              </Label>
              <Select
                value={picked}
                onValueChange={setPicked}
                disabled={!canEdit || save.isPending || active.length === 0}
              >
                <SelectTrigger id={`online-svc-${doctorId}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("none")}</SelectItem>
                  {active.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {nameOf(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canEdit ? (
              <Button
                size="sm"
                onClick={() => save.mutate(picked === NONE ? null : picked)}
                disabled={!dirty || save.isPending}
              >
                <SaveIcon className="size-4" />
                {save.isPending ? t("saving") : t("save")}
              </Button>
            ) : null}
          </div>
          {status ? (
            <p
              className={cn(
                "text-xs",
                status.tone === "warn" ? "text-warning-text" : "text-muted-foreground",
              )}
            >
              {status.text}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
