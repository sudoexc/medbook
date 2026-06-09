"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftIcon,
  ClipboardListIcon,
  FilesIcon,
  FlaskConicalIcon,
  HistoryIcon,
  InfoIcon,
  MessageSquareIcon,
  PhoneIcon,
} from "lucide-react";

import { useTranslations } from "next-intl";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { toast } from "sonner";

import { useDoctorPatientSummary } from "../../_hooks/use-doctor-patient-summary";

import { OverviewSection } from "./overview-section";
import { VisitsSection } from "./visits-section";
import { DocumentsSection } from "./documents-section";
import { PrescriptionsSection } from "./prescriptions-section";
import { LabsSection } from "./labs-section";

const TABS = [
  { value: "overview", labelKey: "detail.tabs.overview", Icon: InfoIcon },
  { value: "visits", labelKey: "detail.tabs.visits", Icon: HistoryIcon },
  { value: "documents", labelKey: "detail.tabs.documents", Icon: FilesIcon },
  { value: "labs", labelKey: "detail.tabs.labs", Icon: FlaskConicalIcon },
  {
    value: "prescriptions",
    labelKey: "detail.tabs.prescriptions",
    Icon: ClipboardListIcon,
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

function isValidTab(value: string | null): value is TabValue {
  return TABS.some((t) => t.value === value);
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2);
  return (
    parts
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "?"
  );
}

function ageFromBirth(iso: string | null): number | null {
  if (!iso) return null;
  const b = new Date(iso);
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  const monthDelta = now.getMonth() - b.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < b.getDate())) {
    years -= 1;
  }
  return years >= 0 ? years : null;
}

export function PatientDetail({
  locale,
  patientId,
}: {
  locale: string;
  patientId: string;
}) {
  const t = useTranslations("doctor.patients");
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = React.useState<TabValue>(
    isValidTab(initialTab) ? initialTab : "overview",
  );

  const summary = useDoctorPatientSummary(patientId);

  // Keep the URL synced with the tab state so deep links (?tab=visits) work
  // both inbound (initial mount above) and outbound (user clicking a tab).
  // We use `replace` so the back button doesn't get cluttered with tab
  // changes.
  const onTabChange = (value: string) => {
    if (!isValidTab(value)) return;
    setTab(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const onWrite = async () => {
    if (!summary.data) return;
    try {
      const res = await fetch(
        "/api/crm/doctors/me/conversations/find-or-create",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId }),
        },
      );
      if (res.status === 422) {
        toast.error(t("toast.noChannel"));
        return;
      }
      if (!res.ok) {
        toast.error(t("toast.chatFailed"));
        return;
      }
      router.push(`/${locale}/doctor/messages?patientId=${patientId}`);
    } catch {
      toast.error(t("toast.chatFailed"));
    }
  };

  if (summary.isLoading) {
    return (
      <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        <div className="h-9 w-80 animate-pulse rounded-lg bg-muted" />
        <div className="h-96 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {t("detail.notFound")}
        </p>
        <Link
          href={`/${locale}/doctor/patients`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("detail.backToList")}
        </Link>
      </div>
    );
  }

  const p = summary.data;
  const age = ageFromBirth(p.birthDate);

  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div>
        <Link
          href={`/${locale}/doctor/patients`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {t("detail.allPatients")}
        </Link>
      </div>

      <section className="rounded-2xl border border-border bg-card px-5 py-4 xl:px-6">
        <div className="flex items-start gap-4">
          <AvatarWithStatus initials={initials(p.fullName)} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {p.fullName}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground tabular-nums">
              {age !== null ? t("detail.ageWithSep", { age }) : ""}
              {p.phone}
              {p.segment ? ` · ${p.segment}` : ""}
            </div>
            {(p.allergies.length > 0 || p.chronicConditions.length > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.allergies.map((a) => (
                  <span
                    key={a.id}
                    className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive"
                    title={a.severity}
                  >
                    {t("detail.allergyTag", { substance: a.substance })}
                  </span>
                ))}
                {p.chronicConditions.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center rounded-md bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning"
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onWrite}
              className="motion-press inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <MessageSquareIcon className="size-4" />
              {t("actions.write")}
            </button>
            <a
              href={`tel:${p.phone}`}
              className="motion-press inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <PhoneIcon className="size-4" />
              {t("actions.call")}
            </a>
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={onTabChange} className="gap-4">
        <TabsList className="self-start">
          {TABS.map(({ value, labelKey, Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon className="size-4" />
              {t(labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewSection summary={p} />
        </TabsContent>
        <TabsContent value="visits">
          <VisitsSection patientId={patientId} locale={locale} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsSection patientId={patientId} />
        </TabsContent>
        <TabsContent value="labs">
          <LabsSection patientId={patientId} />
        </TabsContent>
        <TabsContent value="prescriptions">
          <PrescriptionsSection patientId={patientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
