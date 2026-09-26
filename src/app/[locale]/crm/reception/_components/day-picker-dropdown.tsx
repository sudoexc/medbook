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
import { addTashkentDays } from "@/lib/tashkent-time";

export interface DayPickerDropdownProps {
  /** The chosen clinic day, `YYYY-MM-DD` (Asia/Tashkent). */
  selected: string;
  /** Today's clinic day; the shortcuts and labels are relative to it. */
  today: string;
  onChange: (next: string) => void;
}

/**
 * Compact day selector for the reception doctors panel.
 *
 * - Shortcut items: вчера / сегодня / завтра
 * - Native `<input type="date">` for arbitrary day pick
 * - Active label compresses to "Сегодня" / "Вчера" / "Завтра" when applicable,
 *   otherwise localised "DD MMM" (e.g. "5 мая").
 *
 * Days are clinic calendar days as strings, and "today" comes from the
 * parent's clock-following hook: a Date fixed at mount kept calling
 * yesterday «Сегодня» after midnight (audit AP-12).
 */
export function DayPickerDropdown({
  selected,
  today,
  onChange,
}: DayPickerDropdownProps) {
  const t = useTranslations("reception.doctorsPanel.dayPicker");
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);

  const yesterday = addTashkentDays(today, -1);
  const tomorrow = addTashkentDays(today, 1);

  const label = React.useMemo(() => {
    if (selected === today) return t("labelToday");
    if (selected === yesterday) return t("labelYesterday");
    if (selected === tomorrow) return t("labelTomorrow");
    return new Date(`${selected}T12:00:00+05:00`).toLocaleDateString(
      locale === "uz" ? "uz-UZ" : "ru-RU",
      { day: "numeric", month: "short", timeZone: "Asia/Tashkent" },
    );
  }, [selected, today, yesterday, tomorrow, t, locale]);

  const handlePick = React.useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
    },
    [onChange],
  );

  const onDateInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    // The native input already speaks YYYY-MM-DD.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    handlePick(raw);
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
            value={selected}
            onChange={onDateInput}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
