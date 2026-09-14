"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDownIcon,
  LogOutIcon,
  MoonIcon,
  PlusIcon,
  SendIcon,
  SunIcon,
} from "lucide-react";

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

import { DoctorSearch } from "./doctor-search";
import { AddWalkinDialog } from "../my-day/_components/add-walkin-dialog";
import { useDoctorToday } from "../my-day/_hooks/use-doctor-today";

export function DoctorTopbar({
  doctorName,
  doctorSpecialty,
  doctorAvatarUrl,
  userEmail,
}: DoctorTopbarProps) {
  const t = useTranslations("doctor.nav");
  const locale = useLocale();
  const router = useRouter();
  // Queueing a walk-in must happen wherever the doctor is standing — routing
  // him to «Мой день» was a no-op when he was already there, which is exactly
  // how it was reported ("нажимаю не работает").
  const [addOpen, setAddOpen] = React.useState(false);
  const { data: doctorId } = useDoctorToday<string>((d) => d.doctorId);

  // F2 — the shortcut the button advertises.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        setAddOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
      {/* Search — real: patients, by name/phone/«Фамилия Год». */}
      <DoctorSearch placeholder={t("topbar.searchPlaceholder")} />

      {/* The doctor does not book online slots — that is reception's job. His
          equivalent action is putting a walk-in into his own queue, so the
          button goes where that happens instead of doing nothing. */}
      <button
        type="button"
        disabled={!doctorId}
        onClick={() => setAddOpen(true)}
        className="motion-press inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
      >
        <PlusIcon className="size-4" />
        <span className="hidden sm:inline">{t("topbar.addToQueue")}</span>
        <span className="ml-0.5 hidden h-5 items-center rounded-md bg-white/20 px-1.5 text-[11px] font-semibold tabular-nums lg:inline-flex">
          F2
        </span>
      </button>

      {doctorId ? (
        <AddWalkinDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          doctorId={doctorId}
        />
      ) : null}

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
        {/* Telephony belongs to reception — the doctor had a phone button that
            did nothing, so it is gone rather than decorative. Telegram opens
            the section that actually exists in his sidebar. */}
        <TopbarIconButton
          icon={SendIcon}
          label={t("sidebar.telegram")}
          onClick={() => router.push(`/${locale}/doctor/messages`)}
        />

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
