"use client";

import { Suspense, useState } from "react";
import { getSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { safeCallbackOrHome } from "@/lib/post-login-redirect";
import type { Role } from "@/lib/tenant-context";

const PENDING_SS_KEY = "medbook:2fa-pending";

function readLocaleCookie(): string {
  if (typeof document === "undefined") return "ru";
  const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(ru|uz)/);
  return m?.[1] ?? "ru";
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    // Phase 17 Wave 2 — precheck whether 2FA is required. Doing this in
    // a dedicated endpoint (instead of attempting signIn first and reading
    // the error) lets us distinguish "wrong password" from "missing 2fa"
    // without minting a partially-authenticated session.
    let requiresTotp = false;
    try {
      const r = await fetch("/api/crm/auth/totp-required", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        if (r.status === 401) {
          setError("Неверный email или пароль");
          setPending(false);
          return;
        }
        throw new Error(`HTTP ${r.status}`);
      }
      const data = (await r.json()) as { requiresTotp: boolean };
      requiresTotp = data.requiresTotp;
    } catch {
      setError("Ошибка сети");
      setPending(false);
      return;
    }

    if (requiresTotp) {
      try {
        sessionStorage.setItem(
          PENDING_SS_KEY,
          JSON.stringify({ email, password }),
        );
      } catch {
        /* ignore */
      }
      // Forward callbackUrl only if explicitly set — otherwise let the 2FA
      // form resolve role-home on its own from the post-signIn session.
      const url = callbackUrl
        ? "/login/2fa?callbackUrl=" + encodeURIComponent(callbackUrl)
        : "/login/2fa";
      router.push(url);
      return;
    }

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      setError("Неверный email или пароль");
      return;
    }
    // Pull the freshly-minted session to learn the user's role, then send
    // them to the right surface. Falls back to /ru/crm only if /api/auth
    // somehow returns no session — unlikely right after a successful signIn.
    const session = await getSession();
    const role = (session?.user?.role as Role | undefined) ?? null;
    const locale = readLocaleCookie();
    const target = role
      ? safeCallbackOrHome(callbackUrl, role, locale)
      : `/${locale}/crm`;
    router.push(target);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Вход в CRM</CardTitle>
        <CardDescription>MedBook · NeuroFax</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Входим…" : "Войти"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Suspense fallback={<div className="h-10 w-10 animate-pulse rounded-full bg-muted" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
