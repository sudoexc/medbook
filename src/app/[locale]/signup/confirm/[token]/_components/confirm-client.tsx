"use client";

/**
 * Phase 19 Wave 2 — public signup confirmation client.
 *
 * Calls `POST /api/public/signup/confirm { token }` once on mount, then
 * surfaces the temp password one-shot. The password is shown in clear
 * with a "copy" button — the visitor is forced to change it on first
 * login by the existing `mustChangePassword` middleware redirect, so
 * leaking it on a refresh is fine (the call is single-use; subsequent
 * confirms reject with `consumed`).
 */

import * as React from "react";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ConfirmSuccess {
  ok: true;
  clinicId: string;
  clinicSlug: string;
  email: string;
  tempPassword: string;
  locale: "ru" | "uz";
}

interface ConfirmErrorBody {
  error?: string;
  reason?: "not_found" | "consumed" | "expired" | "email_taken" | string;
}

type View =
  | { kind: "loading" }
  | { kind: "success"; data: ConfirmSuccess }
  | { kind: "error"; reason: string };

export function ConfirmClient({
  locale,
  token,
}: {
  locale: "ru" | "uz";
  token: string;
}) {
  const t = useTranslations("signupConfirm");

  const [view, setView] = React.useState<View>({ kind: "loading" });
  const [copied, setCopied] = React.useState(false);
  const fired = React.useRef(false);

  React.useEffect(() => {
    // Strict-mode double-mount guard. Confirm endpoint is single-use; if
    // we let React fire it twice, the second call will return
    // `reason: "consumed"` which would surface as an error to the
    // visitor on the very first load.
    if (fired.current) return;
    fired.current = true;

    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/public/signup/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (cancelled) return;
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as
            | ConfirmErrorBody
            | null;
          setView({ kind: "error", reason: body?.reason ?? "generic" });
          return;
        }
        const data = (await r.json()) as ConfirmSuccess;
        setView({ kind: "success", data });
      } catch {
        if (!cancelled) setView({ kind: "error", reason: "generic" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function copyPassword(pw: string) {
    try {
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — visitor can still select-and-copy */
    }
  }

  if (view.kind === "loading") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("loadingTitle")}</CardTitle>
          <CardDescription>{t("loadingBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (view.kind === "error") {
    const errorMessage =
      view.reason === "expired"
        ? t("errorExpired")
        : view.reason === "consumed"
          ? t("errorConsumed")
          : t("errorGeneric");
    const signupHref = locale === "ru" ? "/signup" : `/${locale}/signup`;
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("errorTitle")}</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardFooter>
          <a href={signupHref} className="text-sm text-primary underline">
            {t("backToSignup")}
          </a>
        </CardFooter>
      </Card>
    );
  }

  const { data } = view;
  const loginHref = data.locale === "ru" ? "/login" : `/${data.locale}/login`;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("successTitle")}</CardTitle>
        <CardDescription>{t("successBody")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("loginLabel")}
          </span>
          <span className="font-mono text-sm">{data.email}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("passwordLabel")}
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all rounded-md border border-dashed border-border bg-muted/50 px-3 py-2 font-mono text-sm">
              {data.tempPassword}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copyPassword(data.tempPassword)}
            >
              {copied ? t("copiedLabel") : t("copyLabel")}
            </Button>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <a
          href={loginHref}
          className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          {t("loginCta")}
        </a>
      </CardFooter>
    </Card>
  );
}
