/**
 * Phase 19 Wave 2 — public self-service signup landing.
 *
 * Server component shell — locale gate + metadata only. The form itself
 * lives in `_components/signup-form.tsx` because it's interactive.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { hasLocale } from "next-intl";

import { SignupForm } from "./_components/signup-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const titles: Record<string, string> = {
    ru: "Регистрация клиники — NeuroFax",
    uz: "Klinikani ro'yxatdan o'tkazish — NeuroFax",
  };
  return {
    title: titles[locale] ?? titles.ru,
    robots: { index: false, follow: false },
  };
}

export default async function SignupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <SignupForm locale={locale as "ru" | "uz"} />
    </main>
  );
}
