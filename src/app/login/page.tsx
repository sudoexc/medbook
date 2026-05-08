"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PENDING_SS_KEY = "medbook:2fa-pending";

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = search.get("callbackUrl") ?? "/ru/crm";

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
      const url =
        "/login/2fa?callbackUrl=" + encodeURIComponent(callbackUrl);
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
    router.push(callbackUrl);
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
