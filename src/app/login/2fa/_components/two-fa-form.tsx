"use client";

/**
 * /login/2fa form. Lives outside the [locale] segment (parent /login does
 * the same), so there is no NextIntlClientProvider in scope. We use
 * inline Russian strings here to match the parent login page rather than
 * pull a provider in for one form. The login flow has always been
 * Russian-only and is not a hot surface for non-RU users — every staff
 * member configures their account through CRM-internal pages, which DO
 * have full RU/UZ parity.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";

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
    const res = await signIn("credentials", {
      email: pending.email,
      password: pending.password,
      totp: mode === "totp" ? code : "",
      recoveryCode: mode === "recovery" ? recovery : "",
      redirect: false,
    });
    setSubmitting(false);
    if (res?.error) {
      setError("Неверный код. Попробуйте ещё раз.");
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
        <CardTitle>Подтвердите вход</CardTitle>
        <CardDescription>
          Введите 6-значный код из приложения-аутентификатора
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {mode === "totp" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Код</Label>
              <Input
                id="code"
                inputMode="numeric"
                maxLength={6}
                required
                autoComplete="one-time-code"
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="recovery">Резервный код</Label>
              <Input
                id="recovery"
                required
                autoComplete="off"
                placeholder="XXXX-XXXX-XXXX"
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
            {submitting ? "Проверяем…" : "Войти"}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => {
              setError(null);
              setMode((m) => (m === "totp" ? "recovery" : "totp"));
            }}
          >
            {mode === "totp"
              ? "Использовать резервный код"
              : "Использовать код приложения"}
          </button>
          <Link
            href="/login"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Вернуться к входу
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
