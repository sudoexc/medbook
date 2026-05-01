"use client"

/**
 * Phase 9c — Active branch picker for the CRM topbar.
 *
 * Mirrors `ClinicSwitcher` UX: a dropdown with the clinic's branches plus an
 * "All branches" option at the top. The selected branch is persisted in the
 * `active_branch_id` cookie via POST /api/crm/branches/active. After the
 * server confirms, we call `router.refresh()` so the next RSC pass picks up
 * the new tenant context (`branchId` is read by `api-handler.ts` from the
 * cookie).
 *
 * When the clinic has zero or one branch, the switcher hides itself entirely
 * — there is nothing to choose. SUPER_ADMIN with no impersonated clinic
 * also hides (clinicId is null until they pick one in ClinicSwitcher).
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { CheckIcon, ChevronDownIcon, GitBranchIcon } from "lucide-react"

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

type BranchOption = {
  id: string
  slug: string
  nameRu: string
  nameUz: string
  isDefault: boolean
  isActive: boolean
}

export interface BranchSwitcherProps {
  /** Current active branchId from the cookie (server-rendered). `null` = all. */
  currentBranchId?: string | null
  /** When the topbar already knows there's no clinic (e.g. unauthenticated). */
  hasClinic?: boolean
  className?: string
}

export function BranchSwitcher({
  currentBranchId,
  hasClinic = true,
  className,
}: BranchSwitcherProps) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations("branchSwitcher")
  const [branches, setBranches] = React.useState<BranchOption[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [switching, setSwitching] = React.useState<string | "__all__" | null>(
    null,
  )
  const [error, setError] = React.useState<string | null>(null)

  // Eagerly load on mount so we know whether to render the dropdown at all
  // (zero/one branch → hidden). This runs once per topbar instance.
  React.useEffect(() => {
    if (!hasClinic) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/crm/branches?isActive=true&limit=200", {
          cache: "no-store",
        })
        if (!res.ok) {
          if (!cancelled) setBranches([])
          return
        }
        const data = (await res.json()) as { rows?: BranchOption[] }
        if (!cancelled) setBranches(data.rows ?? [])
      } catch {
        if (!cancelled) setBranches([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [hasClinic])

  const switchTo = React.useCallback(
    async (branchId: string | null) => {
      setSwitching(branchId ?? "__all__")
      setError(null)
      try {
        const res = await fetch("/api/crm/branches/active", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ branchId }),
        })
        if (!res.ok) {
          setError(`HTTP ${res.status}`)
          return
        }
        // Re-fetch RSC data so the new branch scope takes effect.
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error")
      } finally {
        setSwitching(null)
      }
    },
    [router],
  )

  const reload = React.useCallback(async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/crm/branches?isActive=true&limit=200", {
        cache: "no-store",
      })
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        setBranches([])
        return
      }
      const data = (await res.json()) as { rows?: BranchOption[] }
      setBranches(data.rows ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error")
      setBranches([])
    } finally {
      setLoading(false)
    }
  }, [loading])

  if (!hasClinic) return null

  // Zero/one branch → switcher is meaningless. We render nothing rather than
  // a static label so the topbar stays compact for single-location clinics.
  if (branches !== null && branches.length <= 1) return null

  const localized = (b: BranchOption) =>
    locale === "uz" ? b.nameUz : b.nameRu

  const current = branches?.find((b) => b.id === currentBranchId)
  const triggerLabel = current ? localized(current) : t("allBranches")

  return (
    <DropdownMenu onOpenChange={(open) => open && void reload()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="default"
          className={cn(
            "h-9 min-w-[160px] justify-start gap-2 text-foreground",
            className,
          )}
          aria-label={t("label")}
        >
          <GitBranchIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-left text-sm">
            {triggerLabel}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t("label")}
        </DropdownMenuLabel>

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            if (currentBranchId !== null && switching === null) {
              void switchTo(null)
            }
          }}
          className="flex items-center justify-between gap-2"
        >
          <span className="truncate text-sm">{t("allBranches")}</span>
          {currentBranchId === null || currentBranchId === "" ? (
            <CheckIcon className="size-4 text-primary" />
          ) : null}
          {switching === "__all__" && (
            <span className="text-xs text-muted-foreground">…</span>
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {loading && <DropdownMenuItem disabled>{t("loading")}</DropdownMenuItem>}

        {!loading && error && (
          <DropdownMenuItem disabled className="text-destructive">
            {error}
          </DropdownMenuItem>
        )}

        {!loading && !error && branches && branches.length === 0 && (
          <DropdownMenuItem disabled>{t("empty")}</DropdownMenuItem>
        )}

        {!loading &&
          !error &&
          branches?.map((b) => {
            const isActive = b.id === currentBranchId
            const isSwitching = switching === b.id
            return (
              <DropdownMenuItem
                key={b.id}
                onSelect={(e) => {
                  e.preventDefault()
                  if (!isActive && !isSwitching) void switchTo(b.id)
                }}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-foreground">
                    {localized(b)}
                    {b.isDefault && (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                        · {t("defaultBadge")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    /{b.slug}
                  </span>
                </span>
                {isActive && <CheckIcon className="size-4 text-primary" />}
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
