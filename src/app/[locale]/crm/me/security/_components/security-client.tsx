"use client";

import * as React from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

type EnrollPayload = { secret: string; otpauthUrl: string; expiresAt: string };
type VerifyPayload = { recoveryCodes: string[] };

async function postJson<T>(
  url: string,
  body: Record<string, unknown> | undefined,
): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => null)) as
      | { error?: string; reason?: string }
      | null;
    throw new Error(data?.error ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

export function SecurityClient(props: {
  enrolled: boolean;
  mandatory: boolean;
  enrolledAt: string | null;
}) {
  const t = useTranslations("crmSecurity");
  const locale = useLocale();

  type View =
    | { kind: "idle" }
    | { kind: "enrolling"; secret: string; otpauthUrl: string; qrDataUrl: string }
    | { kind: "showing-codes"; codes: string[] }
    | { kind: "enrolled" };

  const [view, setView] = React.useState<View>(
    props.enrolled ? { kind: "enrolled" } : { kind: "idle" },
  );
  const [enrollPassword, setEnrollPassword] = React.useState("");
  const [code, setCode] = React.useState("");

  // Modal-driven password capture for the two destructive actions on the
  // enrolled panel. Keeping each in its own state object means a stale
  // value from one flow can't bleed into the other.
  const [regenModal, setRegenModal] = React.useState<{
    open: boolean;
    password: string;
  }>({ open: false, password: "" });
  const [disableModal, setDisableModal] = React.useState<{
    open: boolean;
    password: string;
  }>({ open: false, password: "" });

  const enrollMut = useMutation({
    mutationFn: (password: string) =>
      postJson<EnrollPayload>("/api/crm/me/totp/enroll", { password }),
    onSuccess: async (data) => {
      const qrDataUrl = await QRCode.toDataURL(data.otpauthUrl, {
        width: 220,
        margin: 1,
      });
      setEnrollPassword("");
      setView({
        kind: "enrolling",
        secret: data.secret,
        otpauthUrl: data.otpauthUrl,
        qrDataUrl,
      });
    },
    onError: (e: Error) => mapError(e),
  });

  const verifyMut = useMutation({
    mutationFn: (args: { code: string }) =>
      postJson<VerifyPayload>("/api/crm/me/totp/verify", args),
    onSuccess: (data) => {
      toast.success(t("successEnrolled"));
      setCode("");
      setView({ kind: "showing-codes", codes: data.recoveryCodes });
    },
    onError: (e: Error) => mapError(e),
  });

  const disableMut = useMutation({
    mutationFn: (pw: string) =>
      postJson<{ ok: boolean }>("/api/crm/me/totp/disable", { password: pw }),
    onSuccess: () => {
      toast.success(t("successDisabled"));
      setDisableModal({ open: false, password: "" });
      setView({ kind: "idle" });
    },
    onError: (e: Error) => mapError(e),
  });

  const regenMut = useMutation({
    mutationFn: (pw: string) =>
      postJson<{ recoveryCodes: string[] }>(
        "/api/crm/me/totp/recovery-codes/regenerate",
        { password: pw },
      ),
    onSuccess: (data) => {
      toast.success(t("successRegenerated"));
      setRegenModal({ open: false, password: "" });
      setView({ kind: "showing-codes", codes: data.recoveryCodes });
    },
    onError: (e: Error) => mapError(e),
  });

  function mapError(e: Error) {
    const msg = e.message;
    if (msg === "invalid_code") toast.error(t("errorInvalidCode"));
    else if (msg === "invalid_password") toast.error(t("errorInvalidPassword"));
    else if (msg === "already_enrolled") toast.error(t("errorAlreadyEnrolled"));
    else if (msg === "not_enrolled") toast.error(t("errorNotEnrolled"));
    else if (msg === "enrollment_expired") {
      toast.error(t("errorEnrollmentExpired"));
      // Boot back to idle so the user re-runs /enroll.
      setView({ kind: "idle" });
    } else if (msg === "mandatory_role") toast.error(t("errorMandatoryRole"));
    else if (msg === "RateLimited") toast.error(t("errorRateLimited"));
    else toast.error(t("errorGeneric"));
  }

  // Format enrolledAt for the "Включена с DD.MM.YYYY" status line. We only
  // need a human date — Intl handles the locale split without date-fns.
  const enrolledAtLabel = React.useMemo(() => {
    if (!props.enrolledAt) return null;
    const d = new Date(props.enrolledAt);
    if (Number.isNaN(d.getTime())) return null;
    const fmt = new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn-UZ" : "ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    return fmt.format(d);
  }, [props.enrolledAt, locale]);

  const statusLine = props.enrolled
    ? enrolledAtLabel
      ? t("twoFaEnabledSince", { date: enrolledAtLabel })
      : t("twoFaEnabled")
    : t("twoFaDisabled");

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">{t("twoFaTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{statusLine}</p>
            {props.mandatory && !props.enrolled ? (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {t("twoFaForcedHint")}
              </p>
            ) : null}
          </div>
        </div>

        {view.kind === "idle" ? (
          <IdlePanel
            password={enrollPassword}
            onPasswordChange={setEnrollPassword}
            onStart={() => enrollMut.mutate(enrollPassword)}
            pending={enrollMut.isPending}
          />
        ) : null}

        {view.kind === "enrolling" ? (
          <EnrollingPanel
            qrDataUrl={view.qrDataUrl}
            secret={view.secret}
            code={code}
            onCodeChange={setCode}
            onVerify={() => verifyMut.mutate({ code })}
            onCancel={() => {
              setCode("");
              setView({ kind: "idle" });
            }}
            verifyPending={verifyMut.isPending}
          />
        ) : null}

        {view.kind === "showing-codes" ? (
          <RecoveryCodesPanel
            codes={view.codes}
            onDone={() => setView({ kind: "enrolled" })}
          />
        ) : null}

        {view.kind === "enrolled" ? (
          <ManagePanel
            mandatory={props.mandatory}
            onRequestRegen={() => setRegenModal({ open: true, password: "" })}
            onRequestDisable={() =>
              setDisableModal({ open: true, password: "" })
            }
          />
        ) : null}
      </section>

      <PasswordConfirmDialog
        open={regenModal.open}
        title={t("regenConfirmTitle")}
        body={t("regenConfirmBody")}
        confirmCta={t("regenConfirmCta")}
        confirmVariant="default"
        password={regenModal.password}
        onPasswordChange={(v) => setRegenModal((s) => ({ ...s, password: v }))}
        onCancel={() => setRegenModal({ open: false, password: "" })}
        onConfirm={() => regenMut.mutate(regenModal.password)}
        pending={regenMut.isPending}
      />

      <PasswordConfirmDialog
        open={disableModal.open}
        title={t("disableConfirmTitle")}
        body={t("disableConfirmBody")}
        confirmCta={t("disableConfirmCta")}
        confirmVariant="destructive"
        password={disableModal.password}
        onPasswordChange={(v) =>
          setDisableModal((s) => ({ ...s, password: v }))
        }
        onCancel={() => setDisableModal({ open: false, password: "" })}
        onConfirm={() => disableMut.mutate(disableModal.password)}
        pending={disableMut.isPending}
      />
    </div>
  );
}

function IdlePanel(props: {
  password: string;
  onPasswordChange: (s: string) => void;
  onStart: () => void;
  pending: boolean;
}) {
  const t = useTranslations("crmSecurity");
  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs text-muted-foreground">{t("enrollPasswordIntro")}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="enroll-pw">{t("enrollPasswordLabel")}</Label>
        <Input
          id="enroll-pw"
          type="password"
          autoComplete="current-password"
          value={props.password}
          onChange={(e) => props.onPasswordChange(e.target.value)}
        />
      </div>
      <Button
        onClick={props.onStart}
        disabled={!props.password || props.pending}
      >
        {t("enrollStartCta")}
      </Button>
    </div>
  );
}

function EnrollingPanel(props: {
  qrDataUrl: string;
  secret: string;
  code: string;
  onCodeChange: (s: string) => void;
  onVerify: () => void;
  onCancel: () => void;
  verifyPending: boolean;
}) {
  const t = useTranslations("crmSecurity");
  return (
    <div className="mt-5 space-y-4">
      <p className="text-sm">{t("enrollStepScan")}</p>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-4">
        <Image
          src={props.qrDataUrl}
          alt="QR"
          width={220}
          height={220}
          unoptimized
        />
        <p className="text-xs text-muted-foreground">{t("enrollStepManual")}</p>
        <code className="select-all rounded bg-muted px-2 py-1 text-xs">
          {props.secret}
        </code>
      </div>
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
        {t("enrollRefreshHint")}
      </p>
      <div className="space-y-2">
        <p className="text-sm">{t("enrollStepCode")}</p>
        <Label htmlFor="code">{t("codeLabel")}</Label>
        <Input
          id="code"
          inputMode="numeric"
          maxLength={6}
          placeholder={t("codePlaceholder")}
          value={props.code}
          onChange={(e) => props.onCodeChange(e.target.value.replace(/\D/g, ""))}
        />
        <div className="flex gap-2">
          <Button
            onClick={props.onVerify}
            disabled={props.code.length !== 6 || props.verifyPending}
          >
            {t("verifyCta")}
          </Button>
          <Button
            variant="outline"
            onClick={props.onCancel}
            disabled={props.verifyPending}
          >
            {t("cancelCta")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecoveryCodesPanel(props: { codes: string[]; onDone: () => void }) {
  const t = useTranslations("crmSecurity");
  // The original UI made "Готово" a free transition; users clicked through
  // without actually saving the codes (which can never be re-shown). The
  // gate below blocks the button until the user has either downloaded the
  // .txt file or explicitly ticked the acknowledgement checkbox.
  const [downloaded, setDownloaded] = React.useState(false);
  const [acked, setAcked] = React.useState(false);
  const canProceed = downloaded || acked;

  function download() {
    const blob = new Blob([props.codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medbook-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  return (
    <div className="mt-5 space-y-3">
      <h3 className="text-sm font-semibold">{t("recoveryTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("recoveryHint")}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-sm font-mono">
        {props.codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ul>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={acked}
          onChange={(e) => setAcked(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border"
        />
        {t("recoveryAck")}
      </label>
      <div className="flex gap-2">
        <Button variant="outline" onClick={download}>
          {t("recoveryDownload")}
        </Button>
        <Button onClick={props.onDone} disabled={!canProceed}>
          {t("recoveryDone")}
        </Button>
      </div>
      {!canProceed ? (
        <p className="text-[11px] text-muted-foreground">
          {t("recoveryDoneHint")}
        </p>
      ) : null}
    </div>
  );
}

function ManagePanel(props: {
  mandatory: boolean;
  onRequestRegen: () => void;
  onRequestDisable: () => void;
}) {
  const t = useTranslations("crmSecurity");
  return (
    <div className="mt-5 space-y-3">
      <h3 className="text-sm font-semibold">{t("manageTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("manageHint")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={props.onRequestRegen}>
          {t("recoveryRegenerateCta")}
        </Button>
        {!props.mandatory ? (
          <Button variant="destructive" onClick={props.onRequestDisable}>
            {t("twoFaDisableCta")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PasswordConfirmDialog(props: {
  open: boolean;
  title: string;
  body: string;
  confirmCta: string;
  confirmVariant: "default" | "destructive";
  password: string;
  onPasswordChange: (s: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const t = useTranslations("crmSecurity");
  const canConfirm = props.password.length > 0 && !props.pending;
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(o) => {
        if (!o) props.onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-pw">{t("passwordLabel")}</Label>
          <Input
            id="confirm-pw"
            type="password"
            autoComplete="current-password"
            value={props.password}
            onChange={(e) => props.onPasswordChange(e.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onCancel}>
            {t("cancelCta")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Radix closes the dialog by default on click; we want the
              // mutation to drive open-state via onSuccess instead so an
              // error keeps the dialog open with the typed password.
              e.preventDefault();
              if (canConfirm) props.onConfirm();
            }}
            disabled={!canConfirm}
            className={
              props.confirmVariant === "destructive"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {props.confirmCta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
