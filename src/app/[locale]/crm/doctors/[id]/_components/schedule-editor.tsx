"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { DoctorDetail, DoctorScheduleEntry } from "../_hooks/use-doctor";
import {
  detectScheduleConflicts,
  useReplaceDoctorSchedule,
  type ScheduleSlotInput,
} from "../_hooks/use-doctor-schedule";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// DoctorSchedule.weekday: 0=Sunday..6=Saturday (Prisma convention).
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

type CabinetOption = { id: string; number: string };

function scheduleToSlots(entries: DoctorScheduleEntry[]): ScheduleSlotInput[] {
  return entries
    .map((e) => ({
      weekday: e.weekday,
      startTime: e.startTime,
      endTime: e.endTime,
      cabinetId: e.cabinetId,
    }))
    .sort((a, b) => {
      const dayA = WEEKDAY_ORDER.indexOf(a.weekday as (typeof WEEKDAY_ORDER)[number]);
      const dayB = WEEKDAY_ORDER.indexOf(b.weekday as (typeof WEEKDAY_ORDER)[number]);
      if (dayA !== dayB) return dayA - dayB;
      return a.startTime.localeCompare(b.startTime);
    });
}

export interface ScheduleEditorProps {
  doctor: DoctorDetail;
  className?: string;
}

export function ScheduleEditor({ doctor, className }: ScheduleEditorProps) {
  const t = useTranslations("crmDoctors.schedule");
  const tDays = useTranslations("crmDoctors.weekdays");
  const save = useReplaceDoctorSchedule(doctor.id);

  const cabinetsQuery = useQuery<CabinetOption[], Error>({
    queryKey: ["cabinets", "doctor-schedule"],
    queryFn: async () => {
      const res = await fetch(`/api/crm/cabinets?isActive=true&limit=200`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows: CabinetOption[] };
      return j.rows;
    },
    staleTime: 5 * 60_000,
  });
  const cabinets = cabinetsQuery.data ?? [];

  const baseline = React.useMemo(
    () => scheduleToSlots(doctor.schedules),
    [doctor.schedules],
  );
  const [slots, setSlots] = React.useState<ScheduleSlotInput[]>(baseline);

  // Re-sync slots when server data changes (e.g. after save).
  React.useEffect(() => {
    setSlots(scheduleToSlots(doctor.schedules));
  }, [doctor.schedules]);

  const conflicts = React.useMemo(
    () => detectScheduleConflicts(slots),
    [slots],
  );
  const conflictSet = React.useMemo(() => {
    const m = new Map<number, "invalid-time" | "overlap">();
    for (const c of conflicts) m.set(c.slotIndex, c.kind);
    return m;
  }, [conflicts]);

  const dirty = React.useMemo(() => {
    if (slots.length !== baseline.length) return true;
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i]!;
      const b = baseline[i]!;
      if (
        a.weekday !== b.weekday ||
        a.startTime !== b.startTime ||
        a.endTime !== b.endTime ||
        (a.cabinetId ?? null) !== (b.cabinetId ?? null)
      )
        return true;
    }
    return false;
  }, [slots, baseline]);

  const addSlotForDay = (weekday: number) => {
    setSlots((prev) => [
      ...prev,
      {
        weekday,
        startTime: "09:00",
        endTime: "13:00",
        cabinetId: null,
      },
    ]);
  };

  const updateSlot = (idx: number, patch: Partial<ScheduleSlotInput>) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSave = () => {
    if (conflicts.length > 0) {
      toast.error(t("errorSave"));
      return;
    }
    save.mutate(slots, {
      onSuccess: () => {
        toast.success(t("saved"));
      },
    });
  };

  // Group slots by weekday (indexed). Keep original indexes so updates target
  // the same entry in the flat slots array.
  const byWeekday = React.useMemo(() => {
    const map = new Map<number, { idx: number; slot: ScheduleSlotInput }[]>();
    slots.forEach((slot, idx) => {
      const list = map.get(slot.weekday) ?? [];
      list.push({ idx, slot });
      map.set(slot.weekday, list);
    });
    for (const list of map.values()) {
      list.sort((a, b) => a.slot.startTime.localeCompare(b.slot.startTime));
    }
    return map;
  }, [slots]);

  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)]",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {t("title")}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="text-xs text-[color:var(--warning-foreground)]">
              {t("dirtyHint")}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSlots(baseline)}
            disabled={!dirty || save.isPending}
          >
            <RotateCcwIcon className="size-4" />
            {t("reset")}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || conflicts.length > 0 || save.isPending}
          >
            <SaveIcon className="size-4" />
            {save.isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </div>

      <div className="divide-y divide-border">
        {WEEKDAY_ORDER.map((wd, dayOrderIdx) => {
          const dayKey = DAY_KEYS[dayOrderIdx]!;
          const daySlots = byWeekday.get(wd) ?? [];
          return (
            <div key={wd} className="grid grid-cols-[120px_1fr_auto] items-start gap-3 py-3">
              <div className="pt-1.5 text-sm font-medium text-foreground">
                {tDays(dayKey as never)}
              </div>
              <div className="flex flex-col gap-2">
                {daySlots.length === 0 ? (
                  <span className="text-xs italic text-muted-foreground">
                    {t("emptyDay")}
                  </span>
                ) : (
                  daySlots.map(({ idx, slot }) => {
                    const conflict = conflictSet.get(idx);
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5",
                          conflict &&
                            "border-destructive/60 bg-destructive/5",
                        )}
                      >
                        <Input
                          type="time"
                          value={slot.startTime}
                          onChange={(e) =>
                            updateSlot(idx, { startTime: e.target.value })
                          }
                          className="h-8 w-[110px]"
                          aria-label={t("startTime")}
                        />
                        <span className="text-muted-foreground">–</span>
                        <Input
                          type="time"
                          value={slot.endTime}
                          onChange={(e) =>
                            updateSlot(idx, { endTime: e.target.value })
                          }
                          className="h-8 w-[110px]"
                          aria-label={t("endTime")}
                        />
                        <Select
                          value={slot.cabinetId ?? "__none"}
                          onValueChange={(v) =>
                            updateSlot(idx, {
                              cabinetId: v === "__none" ? null : v,
                            })
                          }
                        >
                          <SelectTrigger
                            className="h-8 w-[160px]"
                            aria-label={t("cabinet")}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none">
                              {t("cabinetNone")}
                            </SelectItem>
                            {cabinets.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                №{c.number}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("removeSlot")}
                          onClick={() => removeSlot(idx)}
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                        {conflict ? (
                          <span className="text-xs text-destructive">
                            {conflict === "overlap"
                              ? t("conflictSlot")
                              : t("invalidTime")}
                          </span>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => addSlotForDay(wd)}
              >
                <PlusIcon className="size-4" />
                {t("addSlot")}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
