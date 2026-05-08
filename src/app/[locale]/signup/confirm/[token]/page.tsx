/**
 * Phase 19 Wave 2 — public signup confirmation landing.
 *
 * Server component shell. Validates the locale, hands the token straight
 * to the client component which calls `POST /api/public/signup/confirm`,
 * then renders the temp-password one-shot screen.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { hasLocale } from "next-intl";

import { ConfirmClient } from "./_components/confirm-client";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const titles: Record<string, string> = {
    ru: "Подтверждение регистрации — NeuroFax",
    uz: "Ro'yxatdan o'tishni tasdiqlash — NeuroFax",
  };
  return {
    title: titles[locale] ?? titles.ru,
    robots: { index: false, follow: false },
  };
}

export default async function SignupConfirmPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <ConfirmClient locale={locale as "ru" | "uz"} token={token} />
    </main>
  );
}
