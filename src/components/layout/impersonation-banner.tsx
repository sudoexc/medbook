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
 *
 * The lease countdown (owner request 09.10.2026, docs/design/OWNER-ACCOUNT.md
 * §2): the visit used to end after 60 minutes without a word. The banner now
 * shows the time left (mm:ss), turns it amber in the last 5 minutes and
 * offers «Продлить» (POST /api/platform/session/extend: a fresh 60 minutes,
 * never past 8 hours from the entry), then refreshes the page's session.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { ShieldIcon, TimerIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { laterIso, leaseClock } from "@/lib/impersonation-lease"

export interface ImpersonationBannerProps {
  /** RU clinic name (server-resolved) — shown verbatim. */
  clinicName: string
  /** Slug shown in muted text after the name. */
  clinicSlug?: string | null
  /**
   * Phase 19 W4 — when set to "VIEW_ONLY", the banner flips from yellow to
   * red and the label changes to «Просмотр без записи / Faqat o'qish» so the
   * SUPER_ADMIN cannot miss that mutations are blocked server-side.
   */
  mode?: "WRITE" | "VIEW_ONLY" | null
  /** ISO end of the lease (`session.user.impersonation.expiresAt`). */
  expiresAt?: string | null
  /** ISO latest end «Продлить» can reach (8 h from the entry). */
  maxExpiresAt?: string | null
  className?: string
}

export function ImpersonationBanner({
  clinicName,
  clinicSlug,
  mode,
  expiresAt,
  maxExpiresAt,
  className,
}: ImpersonationBannerProps) {
  const t = useTranslations("adminPlatform.banner")
  const router = useRouter()
  const viewOnly = mode === "VIEW_ONLY"
  const [exiting, setExiting] = React.useState(false)
  const [extending, setExtending] = React.useState(false)
  const [extendError, setExtendError] = React.useState<string | null>(null)
  // What the last «Продлить» returned, until the refreshed layout hands the
  // same (or a later) end down as props.
  const [extended, setExtended] = React.useState<{
    expiresAt: string
    maxExpiresAt: string | null
  } | null>(null)
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const leaseEnd = laterIso(expiresAt, extended?.expiresAt)
  const leaseCap = laterIso(maxExpiresAt, extended?.maxExpiresAt)
  const clock = leaseClock(leaseEnd, leaseCap, now)

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

  const extend = React.useCallback(async () => {
    if (extending) return
    setExtending(true)
    setExtendError(null)
    try {
      const res = await fetch("/api/platform/session/extend", {
        method: "POST",
      })
      const body = (await res.json().catch(() => null)) as {
        expiresAt?: string
        maxExpiresAt?: string
        reason?: string
      } | null
      if (!res.ok || !body?.expiresAt) {
        setExtendError(
          body?.reason === "lease_cap_reached" ? t("limitReached") : t("extendFailed"),
        )
        return
      }
      setExtended({
        expiresAt: body.expiresAt,
        maxExpiresAt: body.maxExpiresAt ?? null,
      })
      // Re-render the server layout: auth() re-reads the grant, so the
      // session (and every server component) sees the new end.
      router.refresh()
    } catch {
      setExtendError(t("extendFailed"))
    } finally {
      setExtending(false)
    }
  }, [extending, router, t])

  const warn = clock?.warn ?? false

  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-3 border-b px-6 text-sm text-foreground",
        viewOnly
          ? "border-destructive/50 bg-destructive/15"
          : "border-warning/40 bg-warning/15",
        className,
      )}
      role="status"
      aria-live="polite"
      data-mode={viewOnly ? "view-only" : "write"}
    >
      <ShieldIcon
        className={cn(
          "size-4 shrink-0",
          viewOnly ? "text-destructive" : "text-warning",
        )}
      />
      <span className="min-w-0 truncate">
        {viewOnly ? (
          <span className="font-semibold text-destructive">
            Просмотр без записи / Faqat o&apos;qish ·{" "}
          </span>
        ) : (
          <>Режим клиники: </>
        )}
        <span className="font-semibold">{clinicName}</span>
        {clinicSlug ? (
          <span className="ml-1 text-muted-foreground">/{clinicSlug}</span>
        ) : null}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {clock ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs tabular-nums",
              warn
                ? "bg-warning font-semibold text-warning-foreground"
                : "text-muted-foreground",
            )}
            data-lease={clock.expired ? "expired" : warn ? "warn" : "ok"}
            // The first paint uses the server's clock, the next tick the
            // browser's: a second apart at most.
            suppressHydrationWarning
          >
            <TimerIcon className="size-3" aria-hidden />
            {clock.expired ? t("expired") : t("timeLeft", { time: clock.label })}
          </span>
        ) : null}
        {extendError ? (
          <span className="text-xs text-destructive" role="alert">
            {extendError}
          </span>
        ) : null}
        {clock && warn && !clock.expired && clock.canExtend ? (
          <button
            type="button"
            onClick={() => void extend()}
            disabled={extending}
            className="inline-flex items-center gap-1 rounded-md border border-warning bg-card px-2 py-0.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {extending ? t("extending") : t("extend")}
          </button>
        ) : null}
        {clock && warn && !clock.expired && !clock.canExtend && !extendError ? (
          <span className="text-xs text-muted-foreground">{t("limitReached")}</span>
        ) : null}
        <button
          type="button"
          onClick={() => void exit()}
          disabled={exiting}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50",
            viewOnly ? "border-destructive/50" : "border-warning/40",
          )}
        >
          <XIcon className="size-3" />
          {exiting ? "Выход…" : "Выйти"}
        </button>
      </div>
    </div>
  )
}
