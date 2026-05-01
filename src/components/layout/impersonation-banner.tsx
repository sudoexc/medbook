"use client"

/**
 * Visible reminder that a SUPER_ADMIN is browsing CRM as a particular clinic.
 *
 * Rendered above the topbar when `kind === "active"`. Clicking «Выйти»
 * clears the override cookie and navigates to /admin/clinics — same exit
 * path as the dropdown's «Платформа» item, surfaced as a banner so it's
 * impossible to forget you're impersonating while clicking around CRM.
 *
 * The banner also doubles as an audit-trail signal for screen recordings:
 * support engineers can show that destructive actions were taken in
 * impersonation mode rather than as a real clinic admin.
 */

import * as React from "react"
import { ShieldIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface ImpersonationBannerProps {
  /** RU clinic name (server-resolved) — shown verbatim. */
  clinicName: string
  /** Slug shown in muted text after the name. */
  clinicSlug?: string | null
  className?: string
}

export function ImpersonationBanner({
  clinicName,
  clinicSlug,
  className,
}: ImpersonationBannerProps) {
  const [exiting, setExiting] = React.useState(false)

  const exit = React.useCallback(async () => {
    if (exiting) return
    setExiting(true)
    try {
      await fetch("/api/platform/session/switch-clinic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clinicId: null }),
      })
    } catch {
      // best-effort — see ClinicSwitcher.exitToPlatform
    } finally {
      window.location.href = "/admin/clinics"
    }
  }, [exiting])

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-3 border-b border-warning/40 bg-warning/15 px-6 text-sm text-foreground",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <ShieldIcon className="size-4 shrink-0 text-warning" />
      <span className="truncate">
        Режим клиники:{" "}
        <span className="font-semibold">{clinicName}</span>
        {clinicSlug ? (
          <span className="ml-1 text-muted-foreground">/{clinicSlug}</span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => void exit()}
        disabled={exiting}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-warning/40 bg-card px-2 py-0.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        <XIcon className="size-3" />
        {exiting ? "Выход…" : "Выйти"}
      </button>
    </div>
  )
}
