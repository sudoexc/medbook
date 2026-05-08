"use client";

import * as React from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

type EnrollPayload = { secret: string; otpauthUrl: string };
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

  // Three view states.
  type View =
    | { kind: "idle" } // not enrolled, button shown
    | { kind: "enrolling"; secret: string; otpauthUrl: string; qrDataUrl: string }
    | { kind: "showing-codes"; codes: string[] }
    | { kind: "enrolled" };

  const [view, setView] = React.useState<View>(
    props.enrolled ? { kind: "enrolled" } : { kind: "idle" },
  );
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");

  const enrollMut = useMutation({
    mutationFn: () => postJson<EnrollPayload>("/api/crm/me/totp/enroll", undefined),
    onSuccess: async (data) => {
      const qrDataUrl = await QRCode.toDataURL(data.otpauthUrl, {
        width: 220,
        margin: 1,
      });
      setView({ kind: "enrolling", ...data, qrDataUrl });
    },
    onError: (e: Error) => mapError(e),
  });

  const verifyMut = useMutation({
    mutationFn: (args: { secret: string; code: string }) =>
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
      postJson<{ ok: boolean }>("/api/crm/me/totp/disable", {
        password: pw,
      }),
    onSuccess: () => {
      toast.success(t("successDisabled"));
      setPassword("");
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
      setPassword("");
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
    else toast.error(t("errorGeneric"));
  }

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
            <p className="mt-1 text-xs text-muted-foreground">
              {props.enrolled ? t("twoFaEnabled") : t("twoFaDisabled")}
            </p>
            {props.mandatory && !props.enrolled ? (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                {t("twoFaForcedHint")}
              </p>
            ) : null}
          </div>
          {view.kind === "idle" ? (
            <Button
              onClick={() => enrollMut.mutate()}
              disabled={enrollMut.isPending}
            >
              {t("twoFaEnableCta")}
            </Button>
          ) : null}
        </div>

        {view.kind === "enrolling" ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm">{t("enrollStepScan")}</p>
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-4">
              <Image
                src={view.qrDataUrl}
                alt="QR"
                width={220}
                height={220}
                unoptimized
              />
              <p className="text-xs text-muted-foreground">
                {t("enrollStepManual")}
              </p>
              <code className="select-all rounded bg-muted px-2 py-1 text-xs">
                {view.secret}
              </code>
            </div>
            <div className="space-y-2">
              <p className="text-sm">{t("enrollStepCode")}</p>
              <Label htmlFor="code">{t("codeLabel")}</Label>
              <Input
                id="code"
                inputMode="numeric"
                maxLength={6}
                placeholder={t("codePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    verifyMut.mutate({ secret: view.secret, code })
                  }
                  disabled={code.length !== 6 || verifyMut.isPending}
                >
                  {t("verifyCta")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCode("");
                    setView({ kind: "idle" });
                  }}
                  disabled={verifyMut.isPending}
                >
                  {t("cancelCta")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {view.kind === "showing-codes" ? (
          <RecoveryCodesPanel
            codes={view.codes}
            onDone={() => setView({ kind: "enrolled" })}
          />
        ) : null}

        {view.kind === "enrolled" ? (
          <EnrolledPanel
            password={password}
            onPasswordChange={setPassword}
            onDisable={() => disableMut.mutate(password)}
            onRegenerate={() => regenMut.mutate(password)}
            disablePending={disableMut.isPending}
            regenPending={regenMut.isPending}
          />
        ) : null}
      </section>
    </div>
  );
}

function RecoveryCodesPanel(props: {
  codes: string[];
  onDone: () => void;
}) {
  const t = useTranslations("crmSecurity");

  function download() {
    const blob = new Blob([props.codes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "medbook-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="flex gap-2">
        <Button variant="outline" onClick={download}>
          {t("recoveryDownload")}
        </Button>
        <Button onClick={props.onDone}>{t("recoveryDone")}</Button>
      </div>
    </div>
  );
}

function EnrolledPanel(props: {
  password: string;
  onPasswordChange: (s: string) => void;
  onDisable: () => void;
  onRegenerate: () => void;
  disablePending: boolean;
  regenPending: boolean;
}) {
  const t = useTranslations("crmSecurity");
  return (
    <div className="mt-5 space-y-3">
      <p className="text-xs text-muted-foreground">{t("recoveryReprompt")}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="pw">{t("passwordLabel")}</Label>
        <Input
          id="pw"
          type="password"
          autoComplete="current-password"
          value={props.password}
          onChange={(e) => props.onPasswordChange(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={props.onRegenerate}
          disabled={!props.password || props.regenPending}
        >
          {t("recoveryRegenerateCta")}
        </Button>
        <Button
          variant="destructive"
          onClick={props.onDisable}
          disabled={!props.password || props.disablePending}
        >
          {t("twoFaDisableCta")}
        </Button>
      </div>
    </div>
  );
}
