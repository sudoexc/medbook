"use client"

/**
 * SUPER_ADMIN clinic switcher (CRM topbar variant).
 *
 * UX model:
 *   - The dropdown lists every clinic; clicking one impersonates that clinic
 *     (sets the `admin_clinic_override` cookie via /api/platform/session/
 *     switch-clinic) and reloads the page. Hard-reload — not router.refresh
 *     — guarantees that NextAuth re-issues the JWT with the new clinic claim.
 *   - The bottom item «← Платформа» clears the override AND navigates to
 *     /admin/clinics. We bundle both because clearing the override while
 *     remaining on /crm/* leaves the user on a clinic-scoped page with no
 *     clinic — every list goes empty. Going to /admin makes intent explicit.
 *   - No "Admin platform" link or "clear override" button: those were leaky
 *     engineering jargon that confused users. The banner above the topbar
 *     handles the visual reminder that we're in impersonation mode.
 *
 * Non-SUPER_ADMIN users see a read-only clinic name (their tenant lock).
 */

import * as React from "react"
import {
  ArrowLeftIcon,
  BuildingIcon,
  CheckIcon,
  ChevronDownIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

type ClinicOption = {
  id: string
  slug: string
  nameRu: string
  nameUz?: string
}

export interface ClinicSwitcherProps {
  currentClinicId?: string | null
  userRole?:
    | "SUPER_ADMIN"
    | "ADMIN"
    | "DOCTOR"
    | "RECEPTIONIST"
    | "NURSE"
    | "CALL_OPERATOR"
    | null
  fallbackLabel?: string
  clinicName?: string | null
  className?: string
}

export function ClinicSwitcher({
  currentClinicId,
  userRole,
  fallbackLabel = "Клиника не выбрана",
  clinicName,
  className,
}: ClinicSwitcherProps) {
  const [clinics, setClinics] = React.useState<ClinicOption[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [switching, setSwitching] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const isSuperAdmin = userRole === "SUPER_ADMIN"

  const loadClinics = React.useCallback(async () => {
    if (!isSuperAdmin) return
    if (clinics !== null || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/platform/clinics", { cache: "no-store" })
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        setClinics([])
        return
      }
      const data = (await res.json()) as { clinics?: ClinicOption[] }
      setClinics(data.clinics ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
      setClinics([])
    } finally {
      setLoading(false)
    }
  }, [clinics, loading, isSuperAdmin])

  React.useEffect(() => {
    if (isSuperAdmin) void loadClinics()
  }, [isSuperAdmin, loadClinics])

  const switchTo = React.useCallback(async (clinicId: string) => {
    setSwitching(clinicId)
    setError(null)
    try {
      const res = await fetch("/api/platform/session/switch-clinic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clinicId }),
      })
      if (!res.ok) {
        setError(`Switch failed: HTTP ${res.status}`)
        setSwitching(null)
        return
      }
      // Hard reload so NextAuth re-issues the JWT with the new clinic claim.
      // router.refresh() is not enough — the layout re-renders against the
      // already-decoded token, and inconsistent caches can leave the topbar
      // showing the previous clinic until the next full navigation.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
      setSwitching(null)
    }
  }, [])

  const exitToPlatform = React.useCallback(async () => {
    setSwitching("__exit__")
    setError(null)
    try {
      await fetch("/api/platform/session/switch-clinic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clinicId: null }),
      })
    } catch {
      // best-effort: even if the clear fails, navigating to /admin is
      // strictly less harmful than staying on a stale /crm view.
    } finally {
      window.location.href = "/admin/clinics"
    }
  }, [])

  // Non-SUPER_ADMIN: read-only clinic label, no dropdown.
  if (!isSuperAdmin) {
    if (!clinicName && !currentClinicId) return null
    return (
      <div
        className={cn(
          "flex h-9 min-w-[160px] items-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-foreground",
          className,
        )}
      >
        <BuildingIcon className="size-4 text-muted-foreground" />
        <span className="truncate">{clinicName ?? fallbackLabel}</span>
      </div>
    )
  }

  const current = clinics?.find((c) => c.id === currentClinicId)
  const triggerLabel = current?.nameRu ?? fallbackLabel

  return (
    <DropdownMenu onOpenChange={(open) => open && void loadClinics()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="default"
          className={cn(
            "h-9 min-w-[180px] justify-start gap-2 text-foreground",
            className,
          )}
        >
          <BuildingIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-left text-sm">
            {triggerLabel}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Войти в клинику
        </DropdownMenuLabel>

        {loading && <DropdownMenuItem disabled>Загрузка…</DropdownMenuItem>}

        {!loading && error && (
          <DropdownMenuItem disabled className="text-destructive">
            {error}
          </DropdownMenuItem>
        )}

        {!loading && !error && clinics && clinics.length === 0 && (
          <DropdownMenuItem disabled>Нет доступных клиник</DropdownMenuItem>
        )}

        {!loading &&
          !error &&
          clinics?.map((c) => {
            const isActive = c.id === currentClinicId
            const isSwitching = switching === c.id
            return (
              <DropdownMenuItem
                key={c.id}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!isActive && !isSwitching) void switchTo(c.id)
                }}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">
                    {c.nameRu}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    /{c.slug}
                  </span>
                </span>
                {isActive && <CheckIcon className="size-4 text-primary" />}
                {isSwitching && (
                  <span className="text-xs text-muted-foreground">…</span>
                )}
              </DropdownMenuItem>
            )
          })}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            void exitToPlatform()
          }}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
        >
          <ArrowLeftIcon className="size-4 text-muted-foreground" />
          <span>Платформа</span>
          {switching === "__exit__" && (
            <span className="ml-auto text-xs text-muted-foreground">…</span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
