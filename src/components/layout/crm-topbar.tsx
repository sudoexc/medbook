"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useParams, usePathname } from "next/navigation"
import {
  BellIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
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

const SECTION_TITLE: Record<string, { title: string; subtitle: string }> = {
  reception: { title: "Ресепшн", subtitle: "Главный дашборд" },
  appointments: { title: "Записи", subtitle: "Все записи клиники" },
  calendar: { title: "Календарь", subtitle: "Расписание по врачам" },
  patients: { title: "Пациенты", subtitle: "База пациентов" },
  doctors: { title: "Врачи", subtitle: "Аналитика врачей" },
  "call-center": { title: "Call Center", subtitle: "Входящие и исходящие звонки" },
  telegram: { title: "Telegram", subtitle: "Входящие сообщения" },
  sms: { title: "SMS", subtitle: "Входящие и исходящие SMS" },
  documents: { title: "Документы", subtitle: "Библиотека документов" },
  notifications: { title: "Уведомления", subtitle: "Центр уведомлений" },
  analytics: { title: "Аналитика", subtitle: "Сводные метрики" },
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
  const pathname = usePathname() ?? ""
  const params = useParams()
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

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight text-foreground">
          {meta.title}
        </div>
        <div className="truncate text-xs text-muted-foreground">{meta.subtitle}</div>
      </div>

      {/* Global cmdk search — opens on click, ⌘K, or `/`. */}
      <Button
        variant="outline"
        size="default"
        className="hidden h-9 w-[280px] justify-start gap-2 text-muted-foreground md:flex"
        onClick={openSearch}
      >
        <SearchIcon />
        <span className="flex-1 text-left">Поиск по ФИО, телефону, ID…</span>
        <kbd className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          ⌘K · /
        </kbd>
      </Button>
      {searchMounted ? (
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      ) : null}

      <Button size="default" onClick={() => setNewApptOpen(true)}>
        <PlusIcon />
        Новая запись
      </Button>
      <NewAppointmentDialog open={newApptOpen} onOpenChange={setNewApptOpen} />


      {userRole === "SUPER_ADMIN" && (
        <ClinicSwitcher
          currentClinicId={currentClinicId ?? null}
          userRole={userRole}
          className="hidden md:flex"
        />
      )}

      <div className="hidden items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-sm font-medium tabular-nums text-foreground md:flex">
        {timeStr}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <span className="relative">
              <BellIcon />
              <span className="absolute -right-1 -top-1 inline-block size-2 rounded-full bg-destructive ring-2 ring-card" />
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Уведомления</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>Здесь появится лента событий</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "ml-1 flex items-center gap-2 rounded-full p-0.5 transition-colors hover:bg-muted"
            )}
            aria-label="User menu"
          >
            <AvatarWithStatus
              name={userName ?? userEmail ?? "User"}
              status="online"
              size="sm"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs normal-case">
            <div className="font-semibold text-foreground">{userName ?? "Пользователь"}</div>
            <div className="truncate text-muted-foreground">{userEmail ?? "—"}</div>
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
            onClick={() => (onSignOut ? onSignOut() : toast.message("TODO: sign out"))}
          >
            Выйти
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
