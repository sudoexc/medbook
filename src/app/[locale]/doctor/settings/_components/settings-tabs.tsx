"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";

import { NotificationsTab } from "./notifications-tab";
import { ProfileTab } from "./profile-tab";
import { SecurityTab } from "./security-tab";
import { SignatureTab } from "./signature-tab";

type TabKey = "profile" | "signature" | "notifications" | "security";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "profile", label: "Профиль" },
  { key: "signature", label: "Подпись" },
  { key: "notifications", label: "Уведомления" },
  { key: "security", label: "Безопасность" },
];

function tabFromParam(raw: string | null): TabKey {
  if (raw === "signature" || raw === "notifications" || raw === "security") {
    return raw;
  }
  return "profile";
}

export function SettingsTabs() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = React.useState<TabKey>(() =>
    tabFromParam(searchParams.get("tab")),
  );

  const setTabAndUrl = (next: TabKey) => {
    setTab(next);
    const p = new URLSearchParams(searchParams.toString());
    if (next === "profile") p.delete("tab");
    else p.set("tab", next);
    const qs = p.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit rounded-xl border border-border bg-card p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTabAndUrl(t.key)}
            className={cn(
              "motion-press rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? <ProfileTab /> : null}
      {tab === "signature" ? <SignatureTab /> : null}
      {tab === "notifications" ? <NotificationsTab /> : null}
      {tab === "security" ? <SecurityTab locale={locale} /> : null}
    </div>
  );
}
