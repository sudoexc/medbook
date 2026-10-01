"use client";

/**
 * Phase 17 Wave 3 — Mini App account-deletion screen.
 *
 * Two states:
 *   1. No pending request — show before/after summary, optional reason
 *      and notes fields, and a confirmation input (the phone number, or the
 *      word УДАЛИТЬ / O‘CHIRISH for a card with no number). The TG main
 *      button submits to /api/miniapp/account/delete.
 *   2. Pending request — show the scheduled date and a single "Отменить
 *      удаление" button calling /api/miniapp/account/cancel-deletion.
 *
 * The pending state comes from the server (GET /api/miniapp/account/delete)
 * every time the screen opens, so a patient who left the screen can still
 * cancel, and every call goes through useMiniAppFetch (audit MA-12: the
 * hand-rolled fetches carried no clinicSlug and always failed with 400).
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import { MButton, MCard, MEmpty, MErrorInline, MHint, MSection, MSpinner } from "./mini-ui";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useProfile } from "../_hooks/use-profile";
import {
  useCancelDeletion,
  useDeletionStatus,
  useRequestDeletion,
} from "../_hooks/use-account";
import { deletionConfirmationMatches } from "@/lib/patient-experience/account-deletion";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

function splitLines(text: string): string[] {
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

function formatDeletionDate(iso: string, lang: "RU" | "UZ"): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Tashkent",
  });
}

export function AccountDeleteScreen() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const profile = useProfile();
  const status = useDeletionStatus();
  const requestDeletion = useRequestDeletion();
  const cancelDeletion = useCancelDeletion();

  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const busy = requestDeletion.isPending || cancelDeletion.isPending;
  const pending = status.data ?? null;
  const loading = profile.isLoading || status.isLoading;

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my/profile`));
  }, [tg, router, clinicSlug]);

  // A card the Mini App created has no number (the profile hides its tg:
  // stub): it confirms with the word instead, which the server accepts by
  // the same rule.
  const hasPhone = profile.data?.hasPhone ?? false;
  const phone = hasPhone ? (profile.data?.phone ?? "") : "";
  const confirmationOk = deletionConfirmationMatches({
    hasPhone,
    phone,
    confirmation,
  });
  const typedSomething = confirmation.trim().length > 0;

  const onSubmit = React.useCallback(async () => {
    if (!confirmationOk || busy || pending) return;
    try {
      const data = await requestDeletion.mutateAsync({
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
        confirmation,
      });
      tg.haptic.notification("success");
      tg.showAlert(
        t.account.deleteSuccess.replace(
          "{date}",
          formatDeletionDate(data.scheduledFor, lang),
        ),
      );
    } catch (e) {
      tg.haptic.notification("error");
      tg.showAlert(
        (e as Error).message === "confirmation_mismatch"
          ? hasPhone
            ? t.account.deleteConfirmMismatch
            : t.account.deleteConfirmWordMismatch
          : t.account.deleteError,
      );
    }
  }, [
    busy,
    confirmation,
    confirmationOk,
    hasPhone,
    lang,
    notes,
    pending,
    reason,
    requestDeletion,
    t,
    tg,
  ]);

  const onCancel = React.useCallback(async () => {
    if (busy || !pending) return;
    try {
      await cancelDeletion.mutateAsync();
      tg.haptic.notification("success");
      tg.showAlert(t.account.cancelSuccess);
      router.push(`/c/${clinicSlug}/my/profile`);
    } catch {
      tg.haptic.notification("error");
      tg.showAlert(t.account.cancelError);
    }
  }, [busy, cancelDeletion, clinicSlug, pending, router, t, tg]);

  // The TG main button reflects the active mode — submit (pre-pending)
  // or cancel (post-pending). We hide it entirely while the profile or
  // the request status is loading, or when it failed to load, to avoid a
  // confusing dead tap.
  React.useEffect(() => {
    if (loading || status.isError) {
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
    loading,
    status.isError,
    onSubmit,
    onCancel,
    tg,
  ]);

  if (loading) return <MSpinner label={t.common.loading} />;
  // Without the status we cannot tell «scheduled» from «not requested»:
  // offering the form could hide a cancellable request. Retry instead.
  if (status.isError) {
    return (
      <MEmpty>
        <MErrorInline
          text={t.common.loadFailedShort}
          retryLabel={t.common.retry}
          onRetry={() => void status.refetch()}
        />
      </MEmpty>
    );
  }

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
              {hasPhone
                ? t.account.deleteConfirmLabel
                : t.account.deleteConfirmWordLabel}
            </div>
            <input
              type={hasPhone ? "tel" : "text"}
              inputMode={hasPhone ? "tel" : "text"}
              autoCapitalize={hasPhone ? undefined : "characters"}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={hasPhone ? phone || "+998 90 000 00 00" : undefined}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor:
                  "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
            <div className="mt-1">
              {!typedSomething || confirmationOk ? (
                <MHint>{t.account.deleteConfirmHelp}</MHint>
              ) : (
                <p className="text-xs" style={{ color: "var(--ma-danger)" }}>
                  {hasPhone
                    ? t.account.deleteConfirmMismatch
                    : t.account.deleteConfirmWordMismatch}
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
