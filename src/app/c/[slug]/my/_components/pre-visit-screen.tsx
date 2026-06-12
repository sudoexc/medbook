"use client";

/**
 * Phase 16 Wave 2 — Pre-visit questionnaire form (Mini App).
 *
 * Renders 4 fields (complaints, allergies, medications, notes) with the
 * Telegram MainButton wired as Submit. Pulls saved data through
 * `usePreVisit` so the same screen handles both the first fill and the
 * "edit my answers" flow when the patient opens the deeplink twice.
 *
 * Allergies + medications are persisted as `string[]` on the server but
 * presented as one-line-per-entry textareas — the cheapest path to a list
 * input that doesn't require chip-style UI on a tiny screen.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import {
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
import { usePreVisit, useSubmitPreVisit } from "../_hooks/use-pre-visit";

function formatLines(values: string[]): string {
  return values.join("\n");
}

function parseLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

export function PreVisitScreen({ appointmentId }: { appointmentId: string }) {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const { onBehalfOf } = useActiveContext();

  const query = usePreVisit(appointmentId, onBehalfOf);
  const submit = useSubmitPreVisit(appointmentId, onBehalfOf);

  const [complaints, setComplaints] = React.useState("");
  const [allergiesRaw, setAllergiesRaw] = React.useState("");
  const [medicationsRaw, setMedicationsRaw] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);

  // Hydrate the form once when the GET response lands. Subsequent re-renders
  // (e.g. after submit invalidation) keep whatever the user has typed.
  React.useEffect(() => {
    if (hydrated || !query.data) return;
    if (query.data.data) {
      setComplaints(query.data.data.complaints ?? "");
      setAllergiesRaw(formatLines(query.data.data.allergies ?? []));
      setMedicationsRaw(formatLines(query.data.data.medications ?? []));
      setNotes(query.data.data.notes ?? "");
    }
    setHydrated(true);
  }, [hydrated, query.data]);

  const canSubmit =
    complaints.trim().length > 0 &&
    !submit.isPending &&
    query.data?.appointment.status !== "COMPLETED" &&
    query.data?.appointment.status !== "CANCELLED";

  const submittedAt = query.data?.submittedAt ?? null;

  const onSubmit = React.useCallback(async () => {
    setErrMsg(null);
    try {
      await submit.mutateAsync({
        complaints: complaints.trim(),
        allergies: parseLines(allergiesRaw),
        medications: parseLines(medicationsRaw),
        notes: notes.trim(),
      });
      tg.haptic.notification("success");
    } catch (e) {
      tg.haptic.notification("error");
      const err = e as Error & { data?: { reason?: string } };
      const reason = err.data?.reason;
      if (reason === "appointment_not_open") setErrMsg(t.preVisit.notOpen);
      else if (reason === "forbidden") setErrMsg(t.preVisit.forbidden);
      else if (reason === "not_found") setErrMsg(t.preVisit.notFound);
      else setErrMsg(t.preVisit.error);
    }
  }, [submit, complaints, allergiesRaw, medicationsRaw, notes, tg, t]);

  // Wire Telegram MainButton.
  React.useEffect(() => {
    return tg.setMainButton({
      text: submit.isPending
        ? t.preVisit.saving
        : submittedAt
          ? t.preVisit.update
          : t.preVisit.submit,
      active: Boolean(canSubmit),
      progress: submit.isPending,
      visible: true,
      onClick: onSubmit,
    });
  }, [
    tg,
    submit.isPending,
    canSubmit,
    onSubmit,
    submittedAt,
    t.preVisit.saving,
    t.preVisit.submit,
    t.preVisit.update,
  ]);

  if (query.isLoading) return <MSpinner label={t.common.loading} />;
  if (query.isError) return <MEmpty>{t.preVisit.error}</MEmpty>;
  if (!query.data) return <MEmpty>{t.preVisit.notFound}</MEmpty>;

  const appt = query.data.appointment;
  const doctorName = lang === "UZ" ? appt.doctor.nameUz : appt.doctor.nameRu;
  const dateStr = new Date(appt.date).toLocaleString(
    lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
    { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" },
  );

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t.preVisit.title}</h1>
      <p className="mb-3 text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.preVisit.subtitle}
      </p>

      <MCard className="mb-4 text-sm">
        {t.preVisit.appointmentInfo
          .replace("{date}", dateStr)
          .replace("{doctor}", doctorName)}
      </MCard>

      {submittedAt ? (
        <MCard
          className="mb-4 text-sm"
          style={{
            color: "var(--ma-success)",
            backgroundColor: "var(--ma-success-bg)",
          }}
        >
          {t.preVisit.thankYou}{" "}
          <span style={{ color: "var(--tg-hint)" }}>
            (
            {t.preVisit.submittedAt.replace(
              "{at}",
              new Date(submittedAt).toLocaleString(
                lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
                { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" },
              ),
            )}
            )
          </span>
        </MCard>
      ) : null}

      <MSection>
        <MCard className="space-y-4">
          <Field
            label={t.preVisit.complaintsLabel}
            required
          >
            <textarea
              value={complaints}
              onChange={(e) => setComplaints(e.target.value)}
              placeholder={t.preVisit.complaintsPlaceholder}
              rows={4}
              maxLength={2000}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field label={t.preVisit.allergiesLabel} hint={t.preVisit.allergiesHint}>
            <textarea
              value={allergiesRaw}
              onChange={(e) => setAllergiesRaw(e.target.value)}
              placeholder={t.preVisit.allergiesPlaceholder}
              rows={3}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field
            label={t.preVisit.medicationsLabel}
            hint={t.preVisit.medicationsHint}
          >
            <textarea
              value={medicationsRaw}
              onChange={(e) => setMedicationsRaw(e.target.value)}
              placeholder={t.preVisit.medicationsPlaceholder}
              rows={3}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>

          <Field label={t.preVisit.notesLabel}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.preVisit.notesPlaceholder}
              rows={3}
              maxLength={1000}
              className="w-full rounded-xl border px-3 py-3 text-sm"
              style={inputStyle}
            />
          </Field>
        </MCard>
      </MSection>

      {errMsg ? (
        <MCard className="mb-3 text-sm" style={{ color: "var(--ma-danger)" }}>
          {errMsg}
        </MCard>
      ) : null}

      <MHint>{t.preVisit.subtitle}</MHint>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div
        className="mb-1 text-xs font-medium"
        style={{ color: "var(--tg-hint)" }}
      >
        {label}
        {required ? <span style={{ color: "var(--ma-danger)" }}> *</span> : null}
      </div>
      {children}
      {hint ? (
        <div
          className="mt-1 text-[11px]"
          style={{ color: "var(--tg-hint)" }}
        >
          {hint}
        </div>
      ) : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: "var(--tg-bg)",
  borderColor: "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
  color: "var(--tg-text)",
};
