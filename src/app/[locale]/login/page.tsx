"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { Mail, Lock, LogIn } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const locale = useLocale();
  const t = useTranslations("login");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.ok) {
        window.location.href = `/${locale}/dashboard`;
      } else {
        setError(t("error"));
        setLoading(false);
      }
    } catch {
      setError(t("error"));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f8f9fa] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <a href={`/${locale}`} className="inline-block">
            <Image
              src="/logo.png"
              alt="NeuroFax-B"
              width={123}
              height={48}
              priority
              className="h-12 w-auto mx-auto"
            />
          </a>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>

        <div className="rounded-xl border border-border bg-white p-6">
          <h1 className="text-lg font-bold mb-5">{t("title")}</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium flex items-center gap-1.5 mb-1">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {t("email")}
              </label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="doctor@neurofax.uz"
                className="h-10 rounded-lg"
              />
            </div>

            <div>
              <label className="text-sm font-medium flex items-center gap-1.5 mb-1">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                {t("password")}
              </label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                className="h-10 rounded-lg"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/85"
            >
              <LogIn className="mr-2 h-4 w-4" />
              {loading ? t("loading") : t("submit")}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          <a href={`/${locale}`} className="hover:text-foreground transition-colors">
            &larr; {t("backToSite")}
          </a>
        </p>
      </div>
    </div>
  );
}

