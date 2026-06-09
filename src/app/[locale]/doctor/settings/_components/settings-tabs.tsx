"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { NotificationsTab } from "./notifications-tab";
import { PresetsTab } from "./presets-tab";
import { ProfileTab } from "./profile-tab";
import { SecurityTab } from "./security-tab";
import { SignatureTab } from "./signature-tab";

type TabKey =
  | "profile"
  | "signature"
  | "presets"
  | "notifications"
  | "security";

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: "profile", labelKey: "tabs.profile" },
  { key: "signature", labelKey: "tabs.signature" },
  { key: "presets", labelKey: "tabs.presets" },
  { key: "notifications", labelKey: "tabs.notifications" },
  { key: "security", labelKey: "tabs.security" },
];

function tabFromParam(raw: string | null): TabKey {
  if (
    raw === "signature" ||
    raw === "presets" ||
    raw === "notifications" ||
    raw === "security"
  ) {
    return raw;
  }
  return "profile";
}

export function SettingsTabs() {
  const t = useTranslations("doctor.settings");
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
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTabAndUrl(item.key)}
            className={cn(
              "motion-press rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab === item.key
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {tab === "profile" ? <ProfileTab /> : null}
      {tab === "signature" ? <SignatureTab /> : null}
      {tab === "presets" ? <PresetsTab /> : null}
      {tab === "notifications" ? <NotificationsTab /> : null}
      {tab === "security" ? <SecurityTab locale={locale} /> : null}
    </div>
  );
}
