"use client";

/**
 * Phase 19 Wave 2 — public signup landing form.
 *
 * Anonymous client form. POSTs `clinicName + email + phone? + planSlug +
 * playbookSlug? + preferredLocale` to `/api/public/signup`. On success the
 * server returns `{ ok, token, expiresAt }` and we surface the
 * "check-your-inbox" state. The dev confirm-link is rendered behind a
 * `process.env.NODE_ENV !== "production"` gate so a real visitor never
 * sees it but a developer can click straight through during local work.
 */

import * as React from "react";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type PlanSlug = "basic" | "pro";
type PlaybookSlug =
  | "blank"
  | "general"
  | "dental"
  | "neurology"
  | "pediatric"
  | "cosmetology";
type SupportedLocale = "ru" | "uz";

interface SignupResponse {
  ok: true;
  token: string;
  expiresAt: string;
}

interface SignupErrorBody {
  error?: string;
  reason?: string;
}

export function SignupForm({ locale }: { locale: SupportedLocale }) {
  const t = useTranslations("signup");

  const [clinicName, setClinicName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [planSlug, setPlanSlug] = React.useState<PlanSlug>("basic");
  const [playbookSlug, setPlaybookSlug] = React.useState<PlaybookSlug>(
    "general",
  );
  const [preferredLocale, setPreferredLocale] =
    React.useState<SupportedLocale>(locale);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<{
    token: string;
    confirmUrl: string;
  } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clinicName: clinicName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim() || undefined,
          planSlug,
          // Server schema treats "blank" as "skip the playbook" — send
          // undefined so the confirm route stores `null`.
          playbookSlug: playbookSlug === "blank" ? undefined : playbookSlug,
          preferredLocale,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | SignupErrorBody
          | null;
        if (res.status === 409 && body?.reason === "email_taken") {
          setError(t("errorEmailTaken"));
        } else {
          setError(t("errorGeneric"));
        }
        setPending(false);
        return;
      }

      const data = (await res.json()) as SignupResponse;
      const localePath = preferredLocale === "ru" ? "" : `/${preferredLocale}`;
      const confirmUrl = `${localePath}/signup/confirm/${data.token}`;
      setSuccess({ token: data.token, confirmUrl });
    } catch {
      setError(t("errorGeneric"));
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("checkInbox.title")}</CardTitle>
          <CardDescription>
            {t("checkInbox.body", { email })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {process.env.NODE_ENV !== "production" ? (
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">{t("checkInbox.devNote")}</p>
              <a
                href={success.confirmUrl}
                className="mt-1 inline-block break-all text-amber-900 underline underline-offset-2"
              >
                {t("checkInbox.openConfirm")}
              </a>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-4"
          aria-busy={pending}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="clinicName">{t("clinicNameLabel")}</Label>
            <Input
              id="clinicName"
              name="clinicName"
              required
              minLength={2}
              maxLength={120}
              autoComplete="organization"
              placeholder={t("clinicNamePlaceholder")}
              value={clinicName}
              onChange={(e) => setClinicName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("emailLabel")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="phone">{t("phoneLabel")}</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder={t("phonePlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="planSlug">{t("planLabel")}</Label>
            <select
              id="planSlug"
              name="planSlug"
              value={planSlug}
              onChange={(e) => setPlanSlug(e.target.value as PlanSlug)}
              className="flex h-9 w-full items-center rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="basic">{t("planBasic")}</option>
              <option value="pro">{t("planPro")}</option>
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="playbookSlug">{t("playbookLabel")}</Label>
            <select
              id="playbookSlug"
              name="playbookSlug"
              value={playbookSlug}
              onChange={(e) =>
                setPlaybookSlug(e.target.value as PlaybookSlug)
              }
              className="flex h-9 w-full items-center rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="general">{t("playbookGeneral")}</option>
              <option value="dental">{t("playbookDental")}</option>
              <option value="neurology">{t("playbookNeurology")}</option>
              <option value="pediatric">{t("playbookPediatric")}</option>
              <option value="cosmetology">{t("playbookCosmetology")}</option>
              <option value="blank">{t("playbookBlank")}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              {t("playbookHint")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="preferredLocale">{t("localeLabel")}</Label>
            <select
              id="preferredLocale"
              name="preferredLocale"
              value={preferredLocale}
              onChange={(e) =>
                setPreferredLocale(e.target.value as SupportedLocale)
              }
              className="flex h-9 w-full items-center rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="ru">{t("localeRu")}</option>
              <option value="uz">{t("localeUz")}</option>
            </select>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={pending}>
            {pending ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
        <p>{t("footnote")}</p>
        <a
          href={preferredLocale === "ru" ? "/login" : `/${preferredLocale}/login`}
          className="text-primary underline underline-offset-2"
        >
          {t("loginCta")}
        </a>
      </CardFooter>
    </Card>
  );
}
