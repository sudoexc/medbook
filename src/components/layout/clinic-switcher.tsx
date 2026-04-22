"use client"

/**
 * SUPER_ADMIN-only dropdown to switch the active clinic context.
 *
 * Flow:
 *   1. Mount → GET /api/platform/clinics → list of `{ id, slug, nameRu }`.
 *   2. User picks a clinic → POST /api/platform/switch-clinic `{ clinicId }`.
 *   3. Server re-issues the JWT with the new `clinicId` claim.
 *   4. Page reloads so server components pick up the new session.
 *
 * The `/api/platform/*` endpoints are not yet implemented — they belong to
 * `admin-platform-builder` (Phase 4). This component degrades gracefully:
 * while the endpoints are absent the dropdown shows a "soon" state instead
 * of crashing.
 */

import * as React from "react"
import { BuildingIcon, CheckIcon, ChevronDownIcon } from "lucide-react"

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
  /** Optional: label shown in trigger if list not yet loaded. */
  fallbackLabel?: string
  className?: string
}

export function ClinicSwitcher({
  currentClinicId,
  fallbackLabel = "Клиника не выбрана",
  className,
}: ClinicSwitcherProps) {
  const [clinics, setClinics] = React.useState<ClinicOption[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [switching, setSwitching] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const loadClinics = React.useCallback(async () => {
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
  }, [clinics, loading])

  const switchTo = React.useCallback(async (clinicId: string) => {
    setSwitching(clinicId)
    setError(null)
    try {
      const res = await fetch("/api/platform/switch-clinic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clinicId }),
      })
      if (!res.ok) {
        setError(`Switch failed: HTTP ${res.status}`)
        return
      }
      // Full reload so server components & session cookies refresh.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
    } finally {
      setSwitching(null)
    }
  }, [])

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
            className
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
          Переключение клиники
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {loading && (
          <DropdownMenuItem disabled>Загрузка…</DropdownMenuItem>
        )}

        {!loading && error && (
          <DropdownMenuItem disabled className="text-destructive">
            {error}
          </DropdownMenuItem>
        )}

        {!loading && !error && clinics && clinics.length === 0 && (
          <DropdownMenuItem disabled>
            Нет доступных клиник
          </DropdownMenuItem>
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
                {isActive && (
                  <CheckIcon className="size-4 text-primary" />
                )}
                {isSwitching && (
                  <span className="text-xs text-muted-foreground">…</span>
                )}
              </DropdownMenuItem>
            )
          })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
