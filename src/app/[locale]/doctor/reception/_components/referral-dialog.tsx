"use client";

/**
 * P2.1 — Referral (направление) builder.
 *
 * The doctor sends the active patient onward, either to an internal colleague
 * (a User-backed doctor in this clinic) or to an external clinic/specialty
 * (free text). The diagnosis is shown read-only — it's snapshotted from the
 * active visit so the referral can't drift if the note is later re-coded.
 *
 * No print preview opens on success: the patient-facing PDF is rendered async
 * by the `referral-document` worker, so we just close the dialog.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2Icon, Share2Icon, SendIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useDoctorProfile } from "../../settings/_hooks/use-doctor-profile";
import {
  useCreateReferral,
  useReferableColleagues,
} from "../_hooks/use-referrals";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  patientId: string | null;
  visitNoteId: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
};

type Mode = "internal" | "external";

export function ReferralDialog({
  open,
  onOpenChange,
  patientId,
  visitNoteId,
  diagnosisCode,
  diagnosisName,
}: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const [mode, setMode] = React.useState<Mode>("internal");
  const [toDoctorId, setToDoctorId] = React.useState("");
  const [externalTo, setExternalTo] = React.useState("");
  const [reason, setReason] = React.useState("");

  const create = useCreateReferral();
  const profile = useDoctorProfile();
  const colleagues = useReferableColleagues(open && mode === "internal");

  React.useEffect(() => {
    if (!open) return;
    setMode("internal");
    setToDoctorId("");
    setExternalTo("");
    setReason("");
  }, [open]);

  // Exclude the current doctor from the internal-target list.
  const options = (colleagues.data ?? []).filter(
    (c) => c.userId !== profile.data?.id,
  );

  const handleSubmit = () => {
    if (!patientId || !reason.trim()) return;
    if (mode === "internal" && !toDoctorId) return;
    if (mode === "external" && !externalTo.trim()) return;
    create.mutate(
      {
        patientId,
        visitNoteId,
        diagnosisCode,
        diagnosisName,
        reason: reason.trim(),
        toDoctorId: mode === "internal" ? toDoctorId : null,
        externalTo: mode === "external" ? externalTo.trim() : null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const canSubmit =
    !!patientId &&
    !!reason.trim() &&
    (mode === "internal" ? !!toDoctorId : !!externalTo.trim()) &&
    !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2Icon className="size-4" /> {t("referral.title")}
          </DialogTitle>
          <DialogDescription>
            {t("referral.description")}
          </DialogDescription>
        </DialogHeader>

        {!patientId ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {t("referral.noPatientHint")}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              {t("common.icd10")}:{" "}
              <span className="font-medium text-foreground">
                {diagnosisCode ?? "—"}
              </span>
              {diagnosisName ? (
                <span className="ml-1 text-muted-foreground">· {diagnosisName}</span>
              ) : null}
            </div>

            {/* Target mode toggle. */}
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              <ModeTab
                active={mode === "internal"}
                onClick={() => setMode("internal")}
              >
                {t("referral.modeInternal")}
              </ModeTab>
              <ModeTab
                active={mode === "external"}
                onClick={() => setMode("external")}
              >
                {t("referral.modeExternal")}
              </ModeTab>
            </div>

            {mode === "internal" ? (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">{t("referral.doctorLabel")}</span>
                <select
                  value={toDoctorId}
                  onChange={(e) => setToDoctorId(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">
                    {colleagues.isLoading ? t("common.loading") : t("referral.selectDoctor")}
                  </option>
                  {options.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.nameRu}
                      {c.specializationRu ? ` · ${c.specializationRu}` : ""}
                    </option>
                  ))}
                </select>
                {!colleagues.isLoading && options.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("referral.noColleagues")}
                  </span>
                ) : null}
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  {t("referral.clinicSpecialty")}
                </span>
                <input
                  value={externalTo}
                  onChange={(e) => setExternalTo(e.target.value)}
                  placeholder={t("referral.externalPlaceholder")}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </label>
            )}

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">
                {t("referral.reasonLabel")}
              </span>
              <textarea
                className="min-h-[88px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("referral.reasonPlaceholder")}
              />
            </label>

            {create.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                {t("referral.submitError")}{" "}
                {(create.error as Error)?.message ?? t("common.errorFallback")}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            <XIcon className="size-3.5" />
            {t("actions.cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {create.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SendIcon className="size-3.5" />
            )}
            {t("referral.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1.5 font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
