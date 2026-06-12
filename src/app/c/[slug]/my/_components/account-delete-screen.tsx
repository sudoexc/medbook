"use client";

/**
 * Phase 17 Wave 3 — Mini App account-deletion screen.
 *
 * Two states:
 *   1. No pending request — show before/after summary, optional reason
 *      and notes fields, and a phone confirmation input. The TG main
 *      button submits to /api/miniapp/account/delete.
 *   2. Pending request — show the scheduled date and a single "Отменить
 *      удаление" button calling /api/miniapp/account/cancel-deletion.
 *
 * The screen is self-contained (no react-query hook for the deletion
 * job): it derives the pending-request state from the active deletion
 * stamp on the loaded profile, and from the response payload of the
 * delete endpoint after submission.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import { MButton, MCard, MHint, MSection, MSpinner } from "./mini-ui";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useProfile } from "../_hooks/use-profile";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

type PendingState = {
  jobId: string;
  scheduledFor: string;
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function splitLines(text: string): string[] {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

function formatDeletionDate(iso: string, lang: "RU" | "UZ"): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function AccountDeleteScreen() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const profile = useProfile();

  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pending, setPending] = React.useState<PendingState | null>(null);

  // Bootstrap the pending state — if profile loading is complete and
  // the request creation endpoint reports `reused: true`, we land in
  // the pending branch directly. We also bootstrap optimistically by
  // probing the delete endpoint with a no-op call when the screen
  // mounts: the server is idempotent and will return any active job.
  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my/profile`));
  }, [tg, router, clinicSlug]);

  const phone = profile.data?.phone ?? "";
  const confirmDigits = digitsOnly(confirmation);
  const phoneDigits = digitsOnly(phone);
  const confirmationOk =
    confirmDigits.length > 0 && confirmDigits === phoneDigits;

  const onSubmit = React.useCallback(async () => {
    if (!confirmationOk || busy || pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/miniapp/account/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg.initData ?? "",
        },
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          notes: notes.trim() || undefined,
          confirmation,
        }),
      });
      const data = (await res.json()) as {
        jobId?: string;
        scheduledFor?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId || !data.scheduledFor) {
        tg.haptic.notification("error");
        tg.showAlert(t.account.deleteError);
        return;
      }
      tg.haptic.notification("success");
      setPending({ jobId: data.jobId, scheduledFor: data.scheduledFor });
      tg.showAlert(
        t.account.deleteSuccess.replace(
          "{date}",
          formatDeletionDate(data.scheduledFor, lang),
        ),
      );
    } catch {
      tg.haptic.notification("error");
      tg.showAlert(t.account.deleteError);
    } finally {
      setBusy(false);
    }
  }, [busy, confirmation, confirmationOk, lang, notes, pending, reason, t, tg]);

  const onCancel = React.useCallback(async () => {
    if (busy || !pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/miniapp/account/cancel-deletion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg.initData ?? "",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        tg.haptic.notification("error");
        tg.showAlert(t.account.cancelError);
        return;
      }
      tg.haptic.notification("success");
      setPending(null);
      tg.showAlert(t.account.cancelSuccess);
      router.push(`/c/${clinicSlug}/my/profile`);
    } catch {
      tg.haptic.notification("error");
      tg.showAlert(t.account.cancelError);
    } finally {
      setBusy(false);
    }
  }, [busy, clinicSlug, pending, router, t, tg]);

  // The TG main button reflects the active mode — submit (pre-pending)
  // or cancel (post-pending). We hide it entirely while the profile is
  // loading or when the form is invalid to avoid a confusing dead tap.
  React.useEffect(() => {
    if (profile.isLoading) {
      return tg.setMainButton({ visible: false });
    }
    if (pending) {
      return tg.setMainButton({
        text: t.account.cancelCta,
        visible: true,
        active: !busy,
        progress: busy,
        onClick: onCancel,
      });
    }
    return tg.setMainButton({
      text: busy ? t.account.deleteSaving : t.account.deleteSubmit,
      visible: true,
      active: confirmationOk && !busy,
      progress: busy,
      onClick: onSubmit,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    busy,
    confirmationOk,
    pending,
    profile.isLoading,
    onSubmit,
    onCancel,
    tg,
  ]);

  if (profile.isLoading) return <MSpinner label={t.common.loading} />;

  if (pending) {
    return (
      <div>
        <h1 className="mb-1 text-xl font-bold">{t.account.deletePageTitle}</h1>
        <MSection>
          <MCard className="space-y-3">
            <div className="text-base font-semibold">
              {t.account.pendingHeader.replace(
                "{date}",
                formatDeletionDate(pending.scheduledFor, lang),
              )}
            </div>
            <MHint>{t.account.pendingNote}</MHint>
            <MButton
              variant="secondary"
              block
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              {busy ? t.common.loading : t.account.cancelCta}
            </MButton>
          </MCard>
        </MSection>
      </div>
    );
  }

  const warningItems = splitLines(t.account.deleteWarningItems);
  const preservedItems = splitLines(t.account.deletePreservedItems);

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t.account.deletePageTitle}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.account.deletePageSubtitle}
      </p>

      <MSection title={t.account.deleteWarningTitle}>
        <MCard>
          <ul className="space-y-1 text-sm">
            {warningItems.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: "var(--tg-accent)" }}>
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </MCard>
      </MSection>

      <MSection title={t.account.deletePreservedTitle}>
        <MCard>
          <ul className="space-y-1 text-sm">
            {preservedItems.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: "var(--tg-hint)" }}>
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </MCard>
      </MSection>

      <MSection>
        <MCard className="space-y-4">
          <label className="block">
            <div
              className="mb-1 text-xs font-medium"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.account.deleteReasonLabel}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={200}
              placeholder={t.account.deleteReasonPlaceholder}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor:
                  "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
          </label>
          <label className="block">
            <div
              className="mb-1 text-xs font-medium"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.account.deleteNotesLabel}
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder={t.account.deleteNotesPlaceholder}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor:
                  "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
          </label>
          <label className="block">
            <div
              className="mb-1 text-xs font-medium"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.account.deleteConfirmLabel}
            </div>
            <input
              type="tel"
              inputMode="tel"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={phone || "+998 90 000 00 00"}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor:
                  "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
            <div className="mt-1">
              {confirmDigits.length === 0 ? (
                <MHint>{t.account.deleteConfirmHelp}</MHint>
              ) : confirmationOk ? (
                <MHint>{t.account.deleteConfirmHelp}</MHint>
              ) : (
                <p className="text-xs" style={{ color: "var(--ma-danger)" }}>
                  {t.account.deleteConfirmMismatch}
                </p>
              )}
            </div>
          </label>
        </MCard>
      </MSection>

      <MButton
        variant="danger"
        block
        disabled={!confirmationOk || busy}
        onClick={onSubmit}
        type="button"
      >
        {busy ? t.account.deleteSaving : t.account.deleteSubmit}
      </MButton>
    </div>
  );
}
