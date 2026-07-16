"use client";

import * as React from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  ChevronDownIcon,
  LogOutIcon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  userEmail?: string | null;
}

export function DoctorTopbar({
  doctorName,
  doctorSpecialty,
  doctorAvatarUrl,
  userEmail,
}: DoctorTopbarProps) {
  const t = useTranslations("doctor.nav");
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
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
      {/* Search */}
      <div className="relative w-full max-w-[480px]">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder={t("topbar.searchPlaceholder")}
          className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-16 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {searchValue ? (
            <button
              type="button"
              onClick={() => setSearchValue("")}
              aria-label={t("topbar.clearSearch")}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : (
            <kbd className="hidden h-6 select-none items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground md:inline-flex">
              ⌘K
            </kbd>
          )}
        </div>
      </div>

      {/* + Новая запись */}
      <div className="inline-flex h-10 items-stretch overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-sm">
        <button
          type="button"
          className="motion-press inline-flex items-center gap-2 px-3.5 text-sm font-semibold transition-colors hover:bg-primary/90"
        >
          <PlusIcon className="size-4" />
          <span className="hidden sm:inline">{t("topbar.newAppointment")}</span>
          <span className="ml-0.5 hidden h-5 items-center rounded-md bg-white/20 px-1.5 text-[11px] font-semibold tabular-nums lg:inline-flex">
            F2
          </span>
        </button>
        <span aria-hidden className="my-2 w-px bg-white/25" />
        <button
          type="button"
          aria-label={t("topbar.moreActions")}
          className="motion-press inline-flex items-center justify-center px-2 transition-colors hover:bg-primary/90"
        >
          <ChevronDownIcon className="size-4" />
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Clock + date */}
        <div className="hidden flex-col items-end leading-none lg:flex">
          <span className="text-[15px] font-bold tabular-nums text-foreground">
            {now ? formatClock(now) : "—:—"}
          </span>
          <span className="mt-0.5 text-[11px] text-muted-foreground">
            {now ? formatDate(now) : ""}
          </span>
        </div>

        <span aria-hidden className="mx-0.5 hidden h-7 w-px bg-border lg:block" />

        {/* Utility + comms — clean icon buttons, labels via tooltip */}
        <ThemeToggleButton />
        <TopbarIconButton icon={PhoneIcon} label={t("topbar.calls")} />
        <TopbarIconButton icon={SendIcon} label="Telegram" />

        <span aria-hidden className="mx-0.5 h-7 w-px bg-border" />

        {/* Doctor profile — dropdown with sign out. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("topbar.profileMenu")}
              className="motion-press flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-muted"
            >
              <AvatarWithStatus
                src={doctorAvatarUrl ?? undefined}
                name={doctorName}
                status="online"
                size="md"
              />
              <div className="hidden max-w-[160px] text-left leading-tight lg:block">
                <div className="truncate text-sm font-semibold text-foreground">
                  {doctorName}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {doctorSpecialty}
                </div>
              </div>
              <ChevronDownIcon className="hidden size-4 shrink-0 text-muted-foreground lg:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-2">
            <DropdownMenuLabel className="px-2 py-1.5 text-xs normal-case">
              <div className="font-semibold text-foreground">{doctorName}</div>
              <div className="truncate text-muted-foreground">
                {userEmail ?? doctorSpecialty}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-destructive focus:text-destructive"
            >
              <LogOutIcon className="size-4" />
              {t("topbar.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function ThemeToggleButton() {
  const t = useTranslations("doctor.nav");
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const Icon = isDark ? SunIcon : MoonIcon;
  const label = isDark ? t("topbar.lightTheme") : t("topbar.darkTheme");
  return (
    <TopbarIconButton
      icon={Icon}
      label={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    />
  );
}

function TopbarIconButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="motion-press flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
