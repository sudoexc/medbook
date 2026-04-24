"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { DoctorHit } from "./types";

export function DoctorPicker({
  doctors,
  value,
  onChange,
}: {
  doctors: DoctorHit[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations("appointments.newDialog");
  return (
    <div className="grid gap-1">
      <Label>{t("doctor")}</Label>
      <Select
        value={value ?? ""}
        onValueChange={(v) => onChange(v || null)}
      >
        <SelectTrigger>
          <SelectValue placeholder={t("doctorPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {doctors.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: d.color ?? "#3DD5C0" }}
                />
                {d.nameRu}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        {t("doctorHint")}
      </p>
    </div>
  );
}
