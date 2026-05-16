"use client";

import * as React from "react";
import {
  BellIcon,
  ChevronDownIcon,
  MoonIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SunIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { useTheme } from "@/components/providers/theme-provider";

const RU_WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;
const RU_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

function formatClock(d: Date) {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatDate(d: Date) {
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]}, ${RU_WEEKDAYS[d.getDay()]}`;
}

export interface DoctorTopbarProps {
  doctorName: string;
  doctorSpecialty: string;
  doctorAvatarUrl?: string | null;
}

export function DoctorTopbar({
  doctorName,
  doctorSpecialty,
  doctorAvatarUrl,
}: DoctorTopbarProps) {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [searchValue, setSearchValue] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses the search field.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-border bg-card px-6">
      {/* Search */}
      <div className="relative flex-1 max-w-[640px]">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Поиск пациента, врача, записи, телефона, ФИО..."
          className="h-11 w-full rounded-2xl border border-border bg-background pl-10 pr-20 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {searchValue ? (
            <button
              type="button"
              onClick={() => setSearchValue("")}
              aria-label="Очистить поиск"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
          <kbd className="hidden h-6 items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground md:inline-flex">
            ⌘ K
          </kbd>
        </div>
      </div>

      {/* + Новая запись split button */}
      <div className="inline-flex h-11 items-stretch rounded-xl bg-primary text-primary-foreground shadow-sm">
        <button
          type="button"
          className="motion-press inline-flex items-center gap-2 rounded-l-xl px-4 text-sm font-semibold transition-colors hover:bg-primary/90"
        >
          <PlusIcon className="size-4" />
          Новая запись
          <span className="ml-1 inline-flex h-5 items-center rounded-md bg-white/20 px-1.5 text-[11px] font-semibold tabular-nums">
            F2
          </span>
        </button>
        <span aria-hidden className="my-2 w-px bg-white/20" />
        <button
          type="button"
          aria-label="Дополнительные действия"
          className="motion-press inline-flex items-center justify-center rounded-r-xl px-2 transition-colors hover:bg-primary/90"
        >
          <ChevronDownIcon className="size-4" />
        </button>
      </div>

      {/* Clock + date */}
      <div className="ml-1 hidden flex-col items-center leading-tight md:flex">
        <span className="text-lg font-bold tabular-nums text-foreground">
          {now ? formatClock(now) : "—:—"}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {now ? formatDate(now) : ""}
        </span>
      </div>

      {/* Comms icon buttons */}
      <div className="ml-2 flex items-center gap-3">
        <ThemeToggleButton />
        <TopbarIconButton icon={PhoneIcon} label="Звонки" />
        <TopbarIconButton icon={SendIcon} label="Telegram" />
        <TopbarIconButton icon={BellIcon} label="Уведомления" badge={3} />
      </div>

      {/* Doctor profile */}
      <div className="ml-2 flex items-center gap-3">
        <AvatarWithStatus
          src={doctorAvatarUrl ?? undefined}
          name={doctorName}
          status="online"
          size="md"
        />
        <div className="hidden leading-tight md:block">
          <div className="text-sm font-semibold text-foreground">
            {doctorName}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {doctorSpecialty}
          </div>
        </div>
      </div>
    </header>
  );
}

function ThemeToggleButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? SunIcon : MoonIcon;
  return (
    <button
      type="button"
      aria-label={isDark ? "Светлая тема" : "Тёмная тема"}
      title={isDark ? "Светлая тема" : "Тёмная тема"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "motion-press group relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors hover:bg-muted",
      )}
    >
      <span className="relative">
        <Icon className="size-5 text-muted-foreground group-hover:text-foreground" />
      </span>
      <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
        Тема
      </span>
    </button>
  );
}

function TopbarIconButton({
  icon: Icon,
  label,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "motion-press group relative flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors hover:bg-muted",
      )}
    >
      <span className="relative">
        <Icon className="size-5 text-muted-foreground group-hover:text-foreground" />
        {badge && badge > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-[10px] font-medium text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
    </button>
  );
}
