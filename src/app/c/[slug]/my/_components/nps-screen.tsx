"use client";

/**
 * Phase 16 Wave 2 — Post-visit NPS rating screen (Mini App).
 *
 * 1–10 score picker rendered as a row of buttons, plus an optional comment
 * (max 500 chars). The +4h post-visit push lands on this URL with the
 * appointment id in the path.
 *
 * Special states:
 *   - `review` already exists on the GET response → show "thank you" card
 *     with the previous score, hide the form. The Mini App will not let
 *     the patient resubmit (server returns 409 anyway).
 *   - Score < 7 (or whatever `clinic.npsAlertThreshold` is) → after submit,
 *     show a "Спасибо! Мы передали ваш отзыв администрации" message so the
 *     patient understands the alert was logged.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import {
  MButton,
  MCard,
  MEmpty,
  MHint,
  MSection,
  MSpinner,
} from "./mini-ui";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useActiveContext } from "../_hooks/use-active-context";
import { useNps, useSubmitNps, type NpsSubmitResponse } from "../_hooks/use-nps";

export function NpsScreen({ appointmentId }: { appointmentId: string }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const { onBehalfOf } = useActiveContext();

  const query = useNps(appointmentId, onBehalfOf);
  const submit = useSubmitNps(appointmentId, onBehalfOf);

  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState("");
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const [submitResult, setSubmitResult] = React.useState<NpsSubmitResponse | null>(
    null,
  );

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);

  const existingReview = query.data?.review ?? null;
  const alreadySubmitted = Boolean(existingReview) || Boolean(submitResult);
  const canSubmit = score !== null && !submit.isPending && !alreadySubmitted;

  const onSubmit = React.useCallback(async () => {
    if (score === null) return;
    setErrMsg(null);
    try {
      const res = await submit.mutateAsync({
        score,
        comment: comment.trim() || undefined,
      });
      setSubmitResult(res);
      tg.haptic.notification("success");
    } catch (e) {
      tg.haptic.notification("error");
      const err = e as Error & { data?: { reason?: string } };
      const reason = err.data?.reason;
      if (reason === "already_submitted") setErrMsg(t.nps.alreadySubmitted);
      else if (reason === "forbidden") setErrMsg(t.nps.forbidden);
      else if (reason === "not_found") setErrMsg(t.nps.notFound);
      else setErrMsg(t.nps.error);
    }
  }, [submit, score, comment, tg, t]);

  React.useEffect(() => {
    return tg.setMainButton({
      text: submit.isPending ? t.nps.saving : t.nps.submit,
      active: Boolean(canSubmit),
      progress: submit.isPending,
      visible: !alreadySubmitted,
      onClick: onSubmit,
    });
  }, [
    tg,
    submit.isPending,
    canSubmit,
    onSubmit,
    alreadySubmitted,
    t.nps.saving,
    t.nps.submit,
  ]);

  if (query.isLoading) return <MSpinner label={t.common.loading} />;
  if (query.isError) return <MEmpty>{t.nps.error}</MEmpty>;
  if (!query.data) return <MEmpty>{t.nps.notFound}</MEmpty>;

  const appt = query.data.appointment;
  const doctorName = lang === "UZ" ? appt.doctor.nameUz : appt.doctor.nameRu;
  const dateStr = new Date(appt.date).toLocaleDateString(
    lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
    { day: "2-digit", month: "long", year: "numeric" },
  );

  // ── Already-submitted state. Either the GET pre-loaded an existing review
  //    OR we just submitted in this session (`submitResult`).
  if (alreadySubmitted) {
    const finalScore = submitResult?.score ?? existingReview?.score ?? 0;
    const wasLow = submitResult?.adminAlerted ?? false;
    return (
      <div>
        <h1 className="mb-3 text-xl font-bold">{t.nps.title}</h1>
        <MCard
          className="mb-4 text-sm"
          style={{
            color: "var(--ma-success)",
            backgroundColor: "var(--ma-success-bg)",
          }}
        >
          {wasLow ? t.nps.thankYouLow : t.nps.thankYou}
        </MCard>
        <MCard className="mb-4 text-sm">
          {t.nps.yourScore.replace("{score}", String(finalScore))}
        </MCard>
        <MButton
          variant="secondary"
          block
          onClick={() => router.push(`/c/${clinicSlug}/my`)}
        >
          {t.common.close}
        </MButton>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t.nps.title}</h1>
      <p className="mb-3 text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.nps.subtitle}
      </p>

      <MCard className="mb-4 text-sm">
        {t.nps.appointmentInfo
          .replace("{date}", dateStr)
          .replace("{doctor}", doctorName)}
      </MCard>

      <MSection>
        <MCard className="space-y-4">
          <div>
            <div
              className="mb-2 text-xs font-medium"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.nps.scoreLabel}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                const active = score === n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setScore(n);
                      tg.haptic.selection();
                    }}
                    className="min-h-[44px] rounded-xl border text-sm font-semibold ma-press active:scale-[0.98]"
                    style={{
                      backgroundColor: active
                        ? "var(--tg-accent)"
                        : "var(--tg-bg)",
                      color: active ? "#fff" : "var(--tg-text)",
                      borderColor:
                        "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                    }}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <MHint>{t.nps.scoreHint}</MHint>
          </div>

          <label className="block">
            <div
              className="mb-1 text-xs font-medium"
              style={{ color: "var(--tg-hint)" }}
            >
              {t.nps.commentLabel}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t.nps.commentPlaceholder}
              rows={4}
              maxLength={500}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor:
                  "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
          </label>
        </MCard>
      </MSection>

      {errMsg ? (
        <MCard className="mb-3 text-sm" style={{ color: "var(--ma-danger)" }}>
          {errMsg}
        </MCard>
      ) : null}
    </div>
  );
}
