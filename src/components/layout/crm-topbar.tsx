"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { useParams, usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import {
  BellIcon,
  ChevronDownIcon,
  LogOutIcon,
  MoonIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SunIcon,
} from "lucide-react"
import { useTheme } from "@/components/providers/theme-provider"
import { useTranslations } from "next-intl"
import {
  useRouter as useIntlRouter,
  usePathname as useIntlPathname,
} from "@/i18n/navigation"

import { cn } from "@/lib/utils"
import { useShellSummary } from "@/hooks/use-shell-summary"
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

/**
 * URL segment → key under `crmShell.topbar.sections`. The two diverge for
 * `call-center` (kebab-case path, camelCase translation key).
 */
const SECTION_KEY: Record<string, string> = {
  reception: "reception",
  appointments: "appointments",
  calendar: "calendar",
  patients: "patients",
  doctors: "doctors",
  rooms: "rooms",
  services: "services",
  documents: "documents",
  "call-center": "callCenter",
  telegram: "telegram",
  sms: "sms",
  notifications: "notifications",
  analytics: "analytics",
  settings: "settings",
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
  const sectionKey = SECTION_KEY[segment] ?? "reception"
  const tTopbar = useTranslations("crmShell.topbar")
  const tSection = useTranslations(`crmShell.topbar.sections.${sectionKey}`)
  const tRoles = useTranslations("crmShell.topbar.roles")
  const now = useClock()
  const { theme, setTheme } = useTheme()
  const intlRouter = useIntlRouter()
  const intlPathname = useIntlPathname()
  const { data: summary } = useShellSummary()

  const isDark = theme === "dark"
  const switchLocale = (next: "ru" | "uz") => {
    if (next === locale) return
    document.cookie = `NEXT_LOCALE=${next}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
    intlRouter.replace(intlPathname, { locale: next })
  }
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

  // «21 апреля, понедельник» — long Russian date per mockup.
  const dateLocale = locale === "uz" ? "uz-Latn-UZ" : "ru-RU"
  const dateStr = React.useMemo(() => {
    if (now == null) return ""
    const day = new Intl.DateTimeFormat(dateLocale, {
      day: "numeric",
      month: "long",
    }).format(now)
    const weekday = new Intl.DateTimeFormat(dateLocale, {
      weekday: "long",
    }).format(now)
    return `${day}, ${weekday}`
  }, [now, dateLocale])

  const roleLabel = userRole ? tRoles(userRole) : tRoles("fallback")

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
    <header className="flex h-[72px] shrink-0 items-center gap-4 border-b border-border bg-card px-6">
      <div className="hidden min-w-0 shrink-0 leading-tight md:block">
        <div className="truncate text-2xl font-extrabold tracking-tight text-foreground">
          {tSection("title")}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {tSection("subtitle")}
        </div>
      </div>

      <button
        type="button"
        onClick={openSearch}
        className="flex h-11 max-w-[440px] flex-1 items-center gap-2.5 rounded-2xl border border-border bg-background px-4 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <SearchIcon className="size-4" />
        <span className="flex-1 truncate text-left">
          {tTopbar("searchPlaceholder")}
        </span>
        <kbd className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          ⌘ K
        </kbd>
      </button>
      {searchMounted ? (
        <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      ) : null}

      <div className="ml-auto flex items-center gap-4">
        {/* Split button: main + dropdown arrow */}
        <div className="flex h-11 overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Button
            size="lg"
            onClick={() => setNewApptOpen(true)}
            className={cn(
              "h-full gap-2 rounded-none border-0 bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
            )}
          >
            <PlusIcon className="size-4" />
            {tTopbar("newAppointment")}
            <span className="ml-1 rounded-md bg-white/20 px-1.5 py-0.5 text-[11px] font-bold tracking-wide">
              F2
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={tTopbar("moreActions")}
                className="flex h-full items-center border-l border-white/30 px-2 text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <ChevronDownIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setNewApptOpen(true)}>
                {tTopbar("create.appointment")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => toast.message(tTopbar("create.patientStub"))}
              >
                {tTopbar("create.patient")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => toast.message(tTopbar("create.walkinStub"))}
              >
                {tTopbar("create.walkin")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <NewAppointmentDialog open={newApptOpen} onOpenChange={setNewApptOpen} />

        {userRole === "SUPER_ADMIN" && (
          <ClinicSwitcher
            currentClinicId={currentClinicId ?? null}
            userRole={userRole}
            className="hidden md:flex"
          />
        )}

        <div className="hidden flex-col items-end leading-tight tabular-nums md:flex">
          <div className="text-xl font-extrabold tracking-tight text-foreground">
            {timeStr}
          </div>
          <div className="text-[11px] font-medium text-muted-foreground">
            {dateStr}
          </div>
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <TopbarChannelIcon
            label={tTopbar("channels.calls")}
            icon={PhoneIcon}
            badge={summary?.unread.calls ?? 0}
            tone="danger"
            iconClass="text-foreground"
          />
          <TopbarChannelIcon
            label={tTopbar("channels.telegram")}
            icon={SendIcon}
            badge={summary?.unread.telegram ?? 0}
            tone="success"
            iconClass="text-primary"
          />
          <TopbarChannelIcon
            label={tTopbar("channels.notifications")}
            icon={BellIcon}
            badge={summary?.unread.notifications ?? 0}
            tone="danger"
            iconClass="text-foreground"
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
                size="md"
              />
              <div className="hidden text-left leading-tight md:block">
                <div className="flex items-center gap-1 text-sm font-bold text-foreground">
                  {roleLabel}
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                </div>
                <div className="max-w-[160px] truncate text-[11px] text-muted-foreground">
                  {userName ?? userEmail ?? "—"}
                </div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 p-2">
            <DropdownMenuLabel className="px-2 py-1.5 text-xs normal-case">
              <div className="font-semibold text-foreground">
                {userName ?? tTopbar("userMenu.fallbackName")}
              </div>
              <div className="truncate text-muted-foreground">
                {userEmail ?? "—"}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="space-y-2 px-2 py-2">
              <SegmentedRow label={tTopbar("userMenu.theme")}>
                <SegmentedButton
                  active={!isDark}
                  onClick={() => setTheme("light")}
                  aria-label={tTopbar("userMenu.themeLight")}
                >
                  <SunIcon className="size-4" />
                  {tTopbar("userMenu.themeLight")}
                </SegmentedButton>
                <SegmentedButton
                  active={isDark}
                  onClick={() => setTheme("dark")}
                  aria-label={tTopbar("userMenu.themeDark")}
                >
                  <MoonIcon className="size-4" />
                  {tTopbar("userMenu.themeDark")}
                </SegmentedButton>
              </SegmentedRow>
              <SegmentedRow label={tTopbar("userMenu.lang")}>
                <SegmentedButton
                  active={locale === "ru"}
                  onClick={() => switchLocale("ru")}
                  aria-label="Русский"
                >
                  RU
                </SegmentedButton>
                <SegmentedButton
                  active={locale === "uz"}
                  onClick={() => switchLocale("uz")}
                  aria-label="O'zbekcha"
                >
                  UZ
                </SegmentedButton>
              </SegmentedRow>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                onSignOut ? onSignOut() : signOut({ callbackUrl: "/login" })
              }
              className="text-destructive focus:text-destructive"
            >
              <LogOutIcon className="size-4" />
              {tTopbar("userMenu.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function SegmentedRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-12 shrink-0 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-1 items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
        {children}
      </div>
    </div>
  )
}

function SegmentedButton({
  active,
  children,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

function TopbarChannelIcon({
  label,
  icon: Icon,
  badge,
  tone,
  iconClass,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
  tone: "danger" | "success" | "info"
  iconClass?: string
}) {
  const toneClass = {
    danger: "bg-destructive text-destructive-foreground",
    success: "bg-success text-success-foreground",
    info: "bg-info text-info-foreground",
  }[tone]
  return (
    <button
      type="button"
      aria-label={label}
      className="group flex flex-col items-center gap-1"
    >
      <span className="relative flex size-7 items-center justify-center">
        <Icon className={cn("size-[22px]", iconClass)} />
        {badge ? (
          <span
            className={cn(
              "absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ring-[2px] ring-card",
              toneClass,
            )}
          >
            {badge}
          </span>
        ) : null}
      </span>
      <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
    </button>
  )
}
