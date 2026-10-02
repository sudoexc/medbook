"use client"

/**
 * SUPER_ADMIN «enter clinic» dialog, shared by the CRM topbar switcher and
 * /admin/clinics (audit CM-21, rules in @/lib/clinic-entry).
 *
 * «Только просмотр» is preselected, so Enter in the reason field enters
 * read-only; writing takes a deliberate pick of the second option. Cancel and
 * Esc close the dialog without a request, so no grant and no audit row.
 */

import * as React from "react"
import { useTranslations } from "next-intl"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  CLINIC_ENTRY_DEFAULT_MODE,
  CLINIC_ENTRY_MAX_REASON,
  CLINIC_ENTRY_MIN_REASON,
  checkClinicEntry,
  parseClinicEntryMode,
  type ClinicEntry,
  type ClinicEntryMode,
} from "@/lib/clinic-entry"

export type ClinicEntryTarget = { id: string; name: string }

export interface ClinicEntryDialogProps {
  /** The clinic being entered; null keeps the dialog closed. */
  target: ClinicEntryTarget | null
  onCancel: () => void
  /**
   * Sends the entry. Resolve once the page is leaving (reload or navigation);
   * throw to show the error and let the admin retry or cancel.
   */
  onEnter: (clinicId: string, entry: ClinicEntry) => Promise<void>
}

export function ClinicEntryDialog({
  target,
  onCancel,
  onEnter,
}: ClinicEntryDialogProps) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      {/* Keyed per clinic so every opening starts from the safe answer. */}
      {target ? (
        <ClinicEntryForm
          key={target.id}
          target={target}
          onEnter={onEnter}
        />
      ) : null}
    </AlertDialog>
  )
}

function ClinicEntryForm({
  target,
  onEnter,
}: {
  target: ClinicEntryTarget
  onEnter: ClinicEntryDialogProps["onEnter"]
}) {
  const t = useTranslations("adminPlatform.switcher.entry")
  const [reason, setReason] = React.useState("")
  const [mode, setMode] = React.useState<ClinicEntryMode>(
    CLINIC_ENTRY_DEFAULT_MODE,
  )
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const reasonRef = React.useRef<HTMLInputElement>(null)
  const ids = React.useId()

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    const check = checkClinicEntry(reason, mode)
    if (!check.ok) {
      setError(t("reasonTooShort", { min: CLINIC_ENTRY_MIN_REASON }))
      reasonRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onEnter(target.id, { reason: check.reason, mode: check.mode })
      // Stays busy on success: the caller is already reloading the page.
    } catch (err) {
      setError(
        t("failed", { detail: err instanceof Error ? err.message : String(err) }),
      )
      setBusy(false)
    }
  }

  return (
    <AlertDialogContent
      // AlertDialog focuses Cancel by default; the reason comes first.
      onOpenAutoFocus={(e) => {
        e.preventDefault()
        reasonRef.current?.focus()
      }}
      onEscapeKeyDown={(e) => {
        if (busy) e.preventDefault()
      }}
    >
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { clinic: target.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2">
          <Label htmlFor={`${ids}-reason`}>{t("reasonLabel")}</Label>
          <Input
            id={`${ids}-reason`}
            ref={reasonRef}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              if (error) setError(null)
            }}
            placeholder={t("reasonPlaceholder")}
            maxLength={CLINIC_ENTRY_MAX_REASON}
            autoComplete="off"
            disabled={busy}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(parseClinicEntryMode(v))}
          disabled={busy}
          aria-label={t("modeLabel")}
        >
          {(["VIEW_ONLY", "WRITE"] as const).map((value) => {
            const label = value === "WRITE" ? t("write") : t("viewOnly")
            const hint = value === "WRITE" ? t("writeHint") : t("viewOnlyHint")
            return (
              <label
                key={value}
                htmlFor={`${ids}-${value}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 has-[[data-state=checked]]:border-primary"
              >
                <RadioGroupItem
                  id={`${ids}-${value}`}
                  value={value}
                  className="mt-0.5"
                />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium text-foreground">
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            )
          })}
        </RadioGroup>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={busy}>
            {t("cancel")}
          </AlertDialogCancel>
          <Button type="submit" disabled={busy}>
            {busy ? t("entering") : t("enter")}
          </Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  )
}
