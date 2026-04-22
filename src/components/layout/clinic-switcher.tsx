"use client"

/**
 * SUPER_ADMIN clinic switcher + entry point to the /admin/* control plane.
 *
 * Switching mechanism (Phase 4 decision):
 *   The `/api/platform/session/switch-clinic` endpoint sets a signed HttpOnly
 *   cookie `admin_clinic_override=<clinicId>.<hmac>`. The NextAuth `jwt`
 *   callback in `src/lib/auth.ts` reads this cookie on every request when the
 *   user's role is SUPER_ADMIN and overrides `token.clinicId`. This keeps the
 *   JWT signing pipeline intact, is cross-tab safe, revocable (clear the
 *   cookie by POSTing `{clinicId: null}`), and requires no DB state.
 *
 *   After the POST succeeds we call `router.refresh()` so React Server
 *   Components re-fetch with the new session scope. `router.refresh()`
 *   revalidates server data without a hard reload, which preserves scroll
 *   state and client component state.
 *
 * Non-SUPER_ADMIN users see a read-only clinic name (their tenant lock).
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  BuildingIcon,
  CheckIcon,
  ChevronDownIcon,
  ShieldIcon,
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
  /** Current active clinicId (from session). `null` when no clinic is pinned. */
  currentClinicId?: string | null
  /** Current user role — controls dropdown vs read-only render. */
  userRole?:
    | "SUPER_ADMIN"
    | "ADMIN"
    | "DOCTOR"
    | "RECEPTIONIST"
    | "NURSE"
    | "CALL_OPERATOR"
    | null
  /** Optional: label shown in trigger if list not yet loaded. */
  fallbackLabel?: string
  /** Optional: name of the user's own clinic (for non-SUPER_ADMIN render). */
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
  const router = useRouter()
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
      const res = await fetch("/api/platform/clinics", {
        cache: "no-store",
      })
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

  const switchTo = React.useCallback(
    async (clinicId: string | null) => {
      setSwitching(clinicId ?? "__clear__")
      setError(null)
      try {
        const res = await fetch("/api/platform/session/switch-clinic", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clinicId }),
        })
        if (!res.ok) {
          setError(`Switch failed: HTTP ${res.status}`)
          return
        }
        // `router.refresh()` re-runs RSC data fetching with the new session.
        // The jwt callback will pick up the new cookie on the next request.
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error")
      } finally {
        setSwitching(null)
      }
    },
    [router],
  )

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
        <DropdownMenuItem asChild>
          <Link
            href="/admin/clinics"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <ShieldIcon className="size-4 text-primary" />
            <span>Admin platform</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Переключение клиники
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

        {!loading && !error && currentClinicId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                void switchTo(null)
              }}
              className="text-xs text-muted-foreground"
            >
              Очистить override
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
