"use client";

/**
 * /login/2fa form. Lives outside the [locale] segment like /login; the
 * translations come from `src/app/login/layout.tsx`, which provides the
 * `login` and `login2fa` namespaces in the browser's last-used language.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { safeCallbackOrHome } from "@/lib/post-login-redirect";
import type { Role } from "@/lib/tenant-context";

const PENDING_SS_KEY = "medbook:2fa-pending";

function readLocaleCookie(): string {
  if (typeof document === "undefined") return "ru";
  const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(ru|uz)/);
  return m?.[1] ?? "ru";
}

type Pending = { email: string; password: string };

function readPending(): Pending | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Pending>;
    if (typeof parsed.email !== "string" || typeof parsed.password !== "string") {
      return null;
    }
    return { email: parsed.email, password: parsed.password };
  } catch {
    return null;
  }
}

function clearPending() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PENDING_SS_KEY);
  } catch {
    /* ignore */
  }
}

export function TwoFaForm() {
  const t = useTranslations("login2fa");
  const tLogin = useTranslations("login");
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl");

  const [pending, setPending] = React.useState<Pending | null>(null);
  const [mode, setMode] = React.useState<"totp" | "recovery">("totp");
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const p = readPending();
    if (!p) {
      // No pending creds — user opened this page directly. Send them back.
      router.replace("/login");
      return;
    }
    setPending(p);
  }, [router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pending) return;
    setError(null);
    setSubmitting(true);
    let res: Awaited<ReturnType<typeof signIn>>;
    try {
      res = await signIn("credentials", {
        email: pending.email,
        password: pending.password,
        totp: mode === "totp" ? code : "",
        recoveryCode: mode === "recovery" ? recovery : "",
        redirect: false,
      });
    } catch {
      // Never leave the button stuck on «Проверяем…» (audit SEC-03).
      setSubmitting(false);
      setError(tLogin("networkError"));
      return;
    }
    setSubmitting(false);
    // Wrong codes count as failed sign-ins: after too many, the server
    // answers 429 until the window passes.
    if (res?.status === 429 || res?.error === "RateLimited") {
      setError(tLogin("tooManyAttempts"));
      return;
    }
    if (!res || res.error) {
      setError(t("errorInvalid"));
      return;
    }
    clearPending();
    const session = await getSession();
    const role = (session?.user?.role as Role | undefined) ?? null;
    const locale = readLocaleCookie();
    const target = role
      ? safeCallbackOrHome(callbackUrl, role, locale)
      : `/${locale}/crm`;
    router.push(target);
    router.refresh();
  }

  if (!pending) return null;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {mode === "totp" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{t("codeLabel")}</Label>
              <Input
                id="code"
                inputMode="numeric"
                maxLength={6}
                required
                autoComplete="one-time-code"
                placeholder={t("codePlaceholder")}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="recovery">{t("recoveryLabel")}</Label>
              <Input
                id="recovery"
                required
                autoComplete="off"
                placeholder={t("recoveryPlaceholder")}
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
              />
            </div>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={
              submitting ||
              (mode === "totp" ? code.length !== 6 : recovery.length < 12)
            }
          >
            {submitting ? t("loading") : t("submit")}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setError(null);
              setMode((m) => (m === "totp" ? "recovery" : "totp"));
            }}
          >
            {mode === "totp" ? t("useRecovery") : t("useTotp")}
          </button>
          <Link
            href="/login"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("backToLogin")}
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
