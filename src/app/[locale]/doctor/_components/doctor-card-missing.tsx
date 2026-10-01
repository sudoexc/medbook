"use client";

import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { LogOutIcon, UserXIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A DOCTOR login without a schedule card (audit ST-04). The cabinet used to
 * redirect to /crm, and the CRM layout sends every DOCTOR back to /doctor:
 * the browser gave up with «too many redirects» and the doctor had no idea
 * why. Now the doctor sees what is wrong and who can fix it.
 */
export function DoctorCardMissing() {
  const t = useTranslations("doctor.nav.cardMissing");
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
          <UserXIcon className="size-6" aria-hidden />
        </div>
        <h1 className="text-base font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
        <Button
          variant="outline"
          className="mt-2"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOutIcon className="size-4" aria-hidden />
          {t("signOut")}
        </Button>
      </div>
    </main>
  );
}
