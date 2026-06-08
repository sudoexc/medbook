"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  MegaphoneIcon,
  SendIcon,
  Users2Icon,
} from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { NotificationsSubNav } from "../../_components/notifications-sub-nav";
import { useTemplates } from "../../_hooks/use-templates";
import {
  useCreateCampaign,
  useDormantPreview,
  useLaunchCampaign,
  type CampaignChannel,
  type DormantBucket,
} from "../../_hooks/use-campaigns";

const BUCKETS: DormantBucket[] = ["90-180", "180-365", "365+"];

function parseBucket(raw: string | null): DormantBucket | null {
  if (raw === null) return null;
  if (raw === "dormant") return null;
  return (BUCKETS as readonly string[]).includes(raw)
    ? (raw as DormantBucket)
    : null;
}

export function NewCampaignWizard() {
  const t = useTranslations("notifications.campaignsNew");
  const tCampaigns = useTranslations("notifications.campaigns");
  const locale = useLocale() as "ru" | "uz";
  const router = useRouter();
  const search = useSearchParams();

  const initialBucket = React.useMemo(() => parseBucket(search.get("segment")), [search]);
  const sourceActionId = search.get("actionId");

  const [bucket, setBucket] = React.useState<DormantBucket>(
    initialBucket ?? "180-365",
  );
  // SMS removed — TG is the only supported campaign channel.
  const channel: CampaignChannel = "TG";
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [touchedName, setTouchedName] = React.useState(false);

  const previewQuery = useDormantPreview({ bucket, channel });
  const templatesQuery = useTemplates();
  const createMutation = useCreateCampaign();
  const launchMutation = useLaunchCampaign();

  const allTemplates = templatesQuery.data?.rows ?? [];
  const matchingTemplates = React.useMemo(
    () =>
      allTemplates.filter(
        (tpl) =>
          tpl.channel === channel &&
          tpl.isActive &&
          (tpl.category === "MARKETING" || tpl.category === "REMINDER"),
      ),
    [allTemplates, channel],
  );

  // When the channel changes, drop a stale template pick if it no longer matches.
  React.useEffect(() => {
    if (templateId && !matchingTemplates.find((t) => t.id === templateId)) {
      setTemplateId(null);
    }
  }, [matchingTemplates, templateId]);

  // Auto-fill the name from the picked template + bucket until the user types.
  React.useEffect(() => {
    if (touchedName) return;
    if (!templateId) {
      setName("");
      return;
    }
    const tpl = matchingTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const tplName = locale === "uz" ? tpl.nameUz : tpl.nameRu;
    setName(t("namePattern", { template: tplName, bucket }));
  }, [templateId, matchingTemplates, locale, touchedName, t, bucket]);

  const preview = previewQuery.data;
  const submitting = createMutation.isPending || launchMutation.isPending;
  const canLaunch =
    !!templateId &&
    name.trim().length >= 2 &&
    !!preview &&
    preview.eligible > 0 &&
    !submitting;

  async function onLaunch() {
    if (!templateId) return;
    try {
      const created = await createMutation.mutateAsync({
        name: name.trim(),
        channel,
        templateId,
        segment: { kind: "dormant", bucket },
      });
      const result = await launchMutation.mutateAsync({
        id: created.id,
        sourceActionId,
      });
      if (result.alreadyLaunched) {
        toast.info(t("toast.alreadyLaunched"));
      } else if (result.totalCount === 0) {
        toast.warning(t("toast.zeroSent"));
      } else {
        toast.success(t("toast.success", { count: result.totalCount }));
      }
      router.push(`/${locale}/crm/notifications/campaigns`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("toast.error", { message }));
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <SectionHeader
            title={t("title")}
            subtitle={t("subtitle")}
            actions={
              <Link
                href={`/${locale}/crm/notifications/campaigns`}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                )}
              >
                <ArrowLeftIcon className="size-4" />
                {tCampaigns("title")}
              </Link>
            }
          />
          <NotificationsSubNav active="campaigns" />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
            <div className="flex flex-col gap-4">
              {/* Step 1 — bucket picker */}
              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">{t("step1.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("step1.subtitle")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {BUCKETS.map((b) => {
                    const active = b === bucket;
                    return (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBucket(b)}
                        className={cn(
                          "rounded-lg border px-3 py-2 text-xs font-semibold transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-muted/50",
                        )}
                      >
                        {t(`bucketLabel.${b}` as const)}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Step 2 — channel (TG only — SMS removed) */}
              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">{t("step2.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("step2.subtitle")}
                </p>
                <div className="mt-3 flex items-center justify-between rounded-lg border border-primary bg-primary/10 px-3 py-2 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <SendIcon className="size-4" />
                    <span className="font-medium">
                      {t("channelLabel.TG")}
                    </span>
                  </span>
                  {preview ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {preview.channelBreakdown.tgReady}
                    </span>
                  ) : null}
                </div>
              </section>

              {/* Step 3 — template */}
              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">{t("step3.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("step3.subtitle")}
                </p>
                {templatesQuery.isLoading ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {t("step3.loading")}
                  </p>
                ) : matchingTemplates.length === 0 ? (
                  <div className="mt-3 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                    {t("step3.empty")}
                    <div className="mt-2">
                      <Link
                        href={`/${locale}/crm/notifications/templates?channel=${channel}&category=MARKETING`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        {t("step3.createTemplate")}
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <Select
                      value={templateId ?? ""}
                      onValueChange={(v) => setTemplateId(v || null)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("step3.placeholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {matchingTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            {locale === "uz" ? tpl.nameUz : tpl.nameRu}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {templateId ? (
                  <TemplatePreview
                    body={(() => {
                      const tpl = matchingTemplates.find((t) => t.id === templateId);
                      if (!tpl) return "";
                      return locale === "uz" ? tpl.bodyUz : tpl.bodyRu;
                    })()}
                  />
                ) : null}
              </section>

              {/* Step 4 — name */}
              <section className="rounded-xl border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">{t("step4.title")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("step4.subtitle")}
                </p>
                <Input
                  className="mt-3"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setTouchedName(true);
                  }}
                  placeholder={t("step4.placeholder")}
                  maxLength={200}
                />
              </section>
            </div>

            {/* Right rail — audience summary */}
            <aside className="flex flex-col gap-4">
              <AudienceCard
                preview={preview}
                loading={previewQuery.isLoading}
                error={previewQuery.error}
              />
              <LaunchCard
                disabled={!canLaunch}
                submitting={submitting}
                onLaunch={onLaunch}
                eligible={preview?.eligible ?? 0}
                channel={channel}
              />
            </aside>
          </div>
        </PageContainer>
      </div>
    </div>
  );
}

function TemplatePreview({ body }: { body: string }) {
  const t = useTranslations("notifications.campaignsNew");
  if (!body) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("step3.previewTitle")}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{body}</p>
    </div>
  );
}

function AudienceCard({
  preview,
  loading,
  error,
}: {
  preview: ReturnType<typeof useDormantPreview>["data"];
  loading: boolean;
  error: unknown;
}) {
  const t = useTranslations("notifications.campaignsNew.audience");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Users2Icon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t("title")}</h3>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("loading")}</p>
      ) : error ? (
        <p className="mt-3 text-sm text-destructive">{t("error")}</p>
      ) : !preview ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-muted-foreground">{t("eligible")}</p>
            <p className="text-2xl font-bold tabular-nums">{preview.eligible}</p>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Stat label={t("total")} value={preview.total} />
            <Stat label={t("tgReady")} value={preview.channelBreakdown.tgReady} />
            <Stat label={t("noChannel")} value={preview.channelBreakdown.noChannel} />
            <Stat label={t("optedOut")} value={preview.channelBreakdown.optedOut} />
          </dl>
          {preview.sample.length > 0 ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("sample")}
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-xs">
                {preview.sample.map((p) => (
                  <li key={p.id} className="truncate text-foreground">
                    {p.fullName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-background/50 p-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function LaunchCard({
  disabled,
  submitting,
  onLaunch,
  eligible,
  channel,
}: {
  disabled: boolean;
  submitting: boolean;
  onLaunch: () => void;
  eligible: number;
  channel: CampaignChannel;
}) {
  const t = useTranslations("notifications.campaignsNew.launch");
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <MegaphoneIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">{t("title")}</h3>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("description", { channel })}
      </p>
      <Button
        type="button"
        className="mt-3 w-full"
        disabled={disabled}
        onClick={onLaunch}
      >
        <SendIcon className="size-4" />
        {submitting
          ? t("submitting")
          : eligible === 0
            ? t("zero")
            : t("submit", { count: eligible })}
      </Button>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("disclaimer")}
      </p>
    </section>
  );
}
