"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ServiceHit } from "./types";

export function ServicesPicker({
  services,
  value,
  onChange,
}: {
  services: ServiceHit[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("appointments.newDialog");
  const [pick, setPick] = React.useState<string>("");

  const selected = services.filter((s) => value.includes(s.id));
  const available = services.filter((s) => !value.includes(s.id));

  const totalDuration = selected.reduce((acc, s) => acc + s.durationMin, 0);
  const totalPrice = selected.reduce((acc, s) => acc + s.priceBase, 0);

  return (
    <div className="grid gap-1.5">
      <Label>{t("services")}</Label>
      <div className="rounded-md border border-border bg-background">
        {selected.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("servicesEmpty")}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {selected.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{s.nameRu}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.durationMin} {t("minutes")} · {formatSum(s.priceBase)}
                  </div>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => onChange(value.filter((id) => id !== s.id))}
                  aria-label={t("serviceRemove")}
                >
                  <XIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-1 border-t border-border p-2">
          <Select
            value={pick}
            onValueChange={(v) => {
              if (v) {
                onChange([...value, v]);
                setPick("");
              }
            }}
          >
            <SelectTrigger className="h-8 flex-1">
              <SelectValue placeholder={t("serviceAddPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {available.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {t("serviceAllPicked")}
                </div>
              ) : (
                available.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nameRu} · {s.durationMin} {t("minutes")} ·{" "}
                    {formatSum(s.priceBase)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selected.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("total", {
            duration: totalDuration,
            price: formatSum(totalPrice),
          })}
        </p>
      ) : null}
    </div>
  );
}

function formatSum(amount: number): string {
  if (!Number.isFinite(amount) || amount === 0) return "0 сум";
  const whole = Math.trunc(amount / 100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} сум`;
}
