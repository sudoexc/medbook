"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type {
  DoctorPanelDensity,
  DoctorPanelPrefs,
  DoctorPanelSort,
} from "../_hooks/use-panel-prefs";

export interface DoctorPanelSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: DoctorPanelPrefs;
  setPrefs: (patch: Partial<DoctorPanelPrefs>) => void;
  reset: () => void;
}

/**
 * Configuration dialog for the receptionist doctors panel — backed by
 * `useDoctorPanelPrefs` so changes persist per-device.
 */
export function DoctorPanelSettings({
  open,
  onOpenChange,
  prefs,
  setPrefs,
  reset,
}: DoctorPanelSettingsProps) {
  const t = useTranslations("reception.doctorsPanel.settings");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-1">
          <Row
            label={t("hideIdle")}
            hint={t("hideIdleHint")}
            control={
              <Switch
                checked={prefs.hideIdle}
                onCheckedChange={(v) => setPrefs({ hideIdle: v })}
              />
            }
          />

          <Row
            label={t("showCabinet")}
            control={
              <Switch
                checked={prefs.showCabinet}
                onCheckedChange={(v) => setPrefs({ showCabinet: v })}
              />
            }
          />

          <Row
            label={t("showNextSlot")}
            control={
              <Switch
                checked={prefs.showNextSlot}
                onCheckedChange={(v) => setPrefs({ showNextSlot: v })}
              />
            }
          />

          <Group label={t("sortBy")}>
            <SegmentedRadio
              value={prefs.sortBy}
              onChange={(v) => setPrefs({ sortBy: v })}
              options={[
                { value: "load", label: t("sortByLoad") },
                { value: "name", label: t("sortByName") },
                { value: "next", label: t("sortByNext") },
              ]}
            />
          </Group>

          <Group label={t("density")}>
            <SegmentedRadio
              value={prefs.density}
              onChange={(v) => setPrefs({ density: v })}
              options={[
                { value: "comfortable", label: t("densityComfortable") },
                { value: "compact", label: t("densityCompact") },
              ]}
            />
          </Group>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={reset}>
            {t("reset")}
          </Button>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {control}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

function SegmentedRadio<T extends DoctorPanelSort | DoctorPanelDensity>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-border">
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs transition-colors",
              i > 0 ? "border-l border-border" : null,
              active
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
