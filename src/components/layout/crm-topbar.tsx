"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useParams, usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  BellIcon,
  ChevronDownIcon,
  MoonIcon,
  PhoneIncomingIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status"
import { ClinicSwitcher } from "@/components/layout/clinic-switcher"
import { useGlobalSearchShortcut } from "@/components/layout/global-search"
import { toast } from "@/components/ui/sonner"
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog"

// The cmdk search dialog pulls in cmdk + @radix-ui/react-dialog + a slew
// of icons (~50KB gzip combined). Only load it when the user opens the
// dialog (via ⌘K or the topbar button); it lives in every CRM page layout.
const GlobalSearch = dynamic(
  () =>
    import("@/components/layout/global-search").then((m) => m.GlobalSearch),
  { ssr: false },
)

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Супер-админ",
  ADMIN: "Администратор",
  DOCTOR: "Врач",
  RECEPTIONIST: "Ресепшн",
  NURSE: "Медсестра",
  CALL_OPERATOR: "Call-оператор",
}

const SECTION_TITLE: Record<string, { title: string; subtitle: string }> = {
  reception: { title: "Ресепшн", subtitle: "Главный дашборд" },
  appointments: { title: "Записи", subtitle: "Управление записями пациентов" },
  calendar: { title: "Календарь записей", subtitle: "Планирование, сдвиги и подтверждения в реальном времени" },
  patients: { title: "Пациенты", subtitle: "База пациентов и история визитов" },
  doctors: { title: "Врачи", subtitle: "Расписание и результативность" },
  rooms: { title: "Кабинеты", subtitle: "Загрузка помещений и оборудования" },
  services: { title: "Услуги", subtitle: "Каталог услуг и цен" },
  "call-center": { title: "Call Center", subtitle: "Входящие и исходящие звонки" },
  telegram: { title: "Telegram", subtitle: "Чаты с пациентами" },
  sms: { title: "SMS-Email", subtitle: "Входящие и исходящие сообщения" },
  notifications: { title: "Уведомления", subtitle: "Центр уведомлений" },
  analytics: { title: "Аналитика", subtitle: "Сводные метрики клиники" },
  settings: { title: "Настройки", subtitle: "Клиника и пользователи" },
}

function useClock() {
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000 * 30)
    return () => clearInterval(id)
  }, [])
  return now
}

export interface CrmTopbarProps {
  userEmail?: string | null
  userName?: string | null
  userRole?:
    | "SUPER_ADMIN"
    | "ADMIN"
    | "DOCTOR"
    | "RECEPTIONIST"
    | "NURSE"
    | "CALL_OPERATOR"
    | null
  currentClinicId?: string | null
  onSignOut?: () => void
}

export function CrmTopbar({
  userEmail,
  userName,
  userRole,
  currentClinicId,
  onSignOut,
}: CrmTopbarProps) {
  const params = useParams()
  const pathname = usePathname() ?? ""
  const locale = typeof params?.locale === "string" ? params.locale : "ru"
  const segment = pathname.split("/").filter(Boolean)[2] ?? "reception"
  const meta = SECTION_TITLE[segment] ?? SECTION_TITLE.reception
  const now = useClock()
  const { theme, setTheme } = useTheme()
  const [searchMounted, setSearchMounted] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [newApptOpen, setNewApptOpen] = React.useState(false)
  const openSearch = React.useCallback(() => {
    setSearchMounted(true)
    setSearchOpen(true)
  }, [])
  useGlobalSearchShortcut(openSearch)

  const timeStr =
    now == null
      ? "—"
      : new Intl.DateTimeFormat("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(now)

  const dateStr =
    now == null
      ? ""
      : new Intl.DateTimeFormat("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }).format(now)

  const roleLabel = userRole ? ROLE_LABEL[userRole] ?? userRole : "Пользователь"

  // Keyboard shortcut: F2 → open "Новая запись".
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault()
        setNewApptOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
      <div className="hidden min-w-0 shrink-0 leading-tight md:block">
        <div className="truncate text-base font-bold text-foreground">
          {meta.title}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {meta.subtitle}
        </div>
      </div>
      <button
        type="button"
        onClick={openSearch}
        className="flex h-10 max-w-[360px] flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 truncate text-left">
          Поиск пациента, телефона, записи…
        </span>
        <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>
      {searchMounted ? (
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <Button
          size="lg"
          className="h-10 gap-2 rounded-xl bg-primary px-4 text-sm font-semibold shadow-sm hover:bg-primary/90"
          onClick={() => setNewApptOpen(true)}
        >
          <PlusIcon className="size-4" />
          Новая запись
          <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
            F2
          </kbd>
        </Button>
        <NewAppointmentDialog open={newApptOpen} onOpenChange={setNewApptOpen} />

        {userRole === "SUPER_ADMIN" && (
          <ClinicSwitcher
            currentClinicId={currentClinicId ?? null}
            userRole={userRole}
            className="hidden md:flex"
          />
        )}

        <div className="hidden flex-col items-end leading-tight tabular-nums md:flex">
          <div className="text-lg font-bold text-foreground">{timeStr}</div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {dateStr}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <TopbarIconButton
            label="Новые звонки"
            icon={PhoneIncomingIcon}
            badge={3}
            tone="danger"
          />
          <TopbarIconButton
            label="Telegram"
            icon={SendIcon}
            badge={8}
            tone="info"
          />
          <TopbarIconButton
            label="Уведомления"
            icon={BellIcon}
            badge={5}
            tone="danger"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-2 rounded-xl px-1.5 py-1 transition-colors hover:bg-muted",
              )}
              aria-label="User menu"
            >
              <AvatarWithStatus
                name={userName ?? userEmail ?? "User"}
                status="online"
                size="sm"
              />
              <div className="hidden text-left leading-tight md:block">
                <div className="text-xs font-semibold text-foreground">
                  {roleLabel}
                </div>
                <div className="max-w-[120px] truncate text-[10px] text-muted-foreground">
                  {userName ?? userEmail ?? "—"}
                </div>
              </div>
              <ChevronDownIcon className="hidden size-3.5 text-muted-foreground md:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs normal-case">
              <div className="font-semibold text-foreground">
                {userName ?? "Пользователь"}
              </div>
              <div className="truncate text-muted-foreground">
                {userEmail ?? "—"}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                toast.message(`Текущий язык: ${locale.toUpperCase()}`)
              }
            >
              Язык: {locale.toUpperCase()}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                onSignOut ? onSignOut() : signOut({ callbackUrl: "/login" })
              }
            >
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function TopbarIconButton({
  label,
  icon: Icon,
  badge,
  tone,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
  tone: "danger" | "info"
}) {
  const toneClass =
    tone === "danger"
      ? "bg-destructive text-destructive-foreground"
      : "bg-info text-info-foreground"
  return (
    <button
      type="button"
      aria-label={label}
      className="relative flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="size-4" />
      {badge ? (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ring-2 ring-card",
            toneClass,
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}
