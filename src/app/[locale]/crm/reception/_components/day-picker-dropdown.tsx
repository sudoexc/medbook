"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export interface DayPickerDropdownProps {
  selected: Date;
  onChange: (next: Date) => void;
}

/**
 * Compact day selector for the reception doctors panel.
 *
 * - Shortcut items: вчера / сегодня / завтра
 * - Native `<input type="date">` for arbitrary day pick
 * - Active label compresses to "Сегодня" / "Вчера" / "Завтра" when applicable,
 *   otherwise localised "DD MMM" (e.g. "5 мая").
 */
export function DayPickerDropdown({ selected, onChange }: DayPickerDropdownProps) {
  const t = useTranslations("reception.doctorsPanel.dayPicker");
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);

  const today = startOfDay(new Date());
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  const label = React.useMemo(() => {
    if (isSameDay(selected, today)) return t("labelToday");
    if (isSameDay(selected, yesterday)) return t("labelYesterday");
    if (isSameDay(selected, tomorrow)) return t("labelTomorrow");
    return selected.toLocaleDateString(locale === "uz" ? "uz-UZ" : "ru-RU", {
      day: "numeric",
      month: "short",
    });
  }, [selected, today, yesterday, tomorrow, t, locale]);

  const dateInputValue = React.useMemo(() => {
    const d = startOfDay(selected);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }, [selected]);

  const handlePick = React.useCallback(
    (next: Date) => {
      onChange(startOfDay(next));
      setOpen(false);
    },
    [onChange],
  );

  const onDateInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!raw) return;
    const [y, m, d] = raw.split("-").map((s) => Number.parseInt(s, 10));
    if (!y || !m || !d) return;
    handlePick(new Date(y, m - 1, d));
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
          {label}
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => handlePick(yesterday)}>
          {t("yesterday")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlePick(today)}>
          {t("today")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => handlePick(tomorrow)}>
          {t("tomorrow")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            {t("pickDate")}
          </label>
          <input
            type="date"
            value={dateInputValue}
            onChange={onDateInput}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
