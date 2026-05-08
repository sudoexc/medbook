"use client";

/**
 * White-label settings client. Three concerns: logo upload, brand colours,
 * custom subdomain.
 *
 * The page submits via multipart so we can carry the file alongside the
 * scalar fields in a single request. When no file is selected we still
 * use FormData (server doesn't care; saves a code branch).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SaveIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { settingsFetch } from "../../_hooks/use-settings-api";

type BrandingDto = {
  logoUrl: string | null;
  brandColor: string;
  brandSecondaryColor: string | null;
  customSubdomain: string | null;
  hasWhiteLabel: boolean;
  hasCustomSubdomain: boolean;
};

export function BrandingPageClient({
  hasCustomSubdomain,
}: {
  hasCustomSubdomain: boolean;
}) {
  const t = useTranslations("branding");
  const qc = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [primary, setPrimary] = React.useState<string>("#3DD5C0");
  const [secondary, setSecondary] = React.useState<string>("");
  const [subdomain, setSubdomain] = React.useState<string>("");
  const [pendingFile, setPendingFile] = React.useState<File | null>(null);

  const q = useQuery({
    queryKey: ["settings", "branding"],
    queryFn: () => settingsFetch<BrandingDto>("/api/crm/settings/branding"),
  });

  React.useEffect(() => {
    if (!q.data) return;
    setPrimary(q.data.brandColor || "#3DD5C0");
    setSecondary(q.data.brandSecondaryColor ?? "");
    setSubdomain(q.data.customSubdomain ?? "");
  }, [q.data]);

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set("brandColor", primary);
      if (secondary) {
        fd.set("brandSecondaryColor", secondary);
      } else {
        // explicit empty signals "clear"
        fd.set("brandSecondaryColor", "");
      }
      // customSubdomain: empty → clear; non-empty → set.
      fd.set("customSubdomain", subdomain.trim());
      if (pendingFile) fd.set("logo", pendingFile);
      const res = await fetch("/api/crm/settings/branding", {
        method: "PATCH",
        body: fd,
      });
      const text = await res.text();
      if (!res.ok) {
        let parsed: { error?: string; reason?: string } = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          /* noop */
        }
        throw new Error(
          parsed.reason ?? parsed.error ?? `HTTP ${res.status}`,
        );
      }
      return text ? JSON.parse(text) : null;
    },
    onSuccess: () => {
      toast.success(t("saved"));
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["settings", "branding"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("description")} />

      {q.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : q.error ? (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      ) : (
        <form
          className="grid max-w-xl gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label>{t("logo.label")}</Label>
            {q.data?.logoUrl ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={q.data.logoUrl}
                  alt="logo"
                  className="h-10 w-10 rounded-sm object-contain"
                />
                <span className="truncate text-xs text-muted-foreground">
                  {q.data.logoUrl}
                </span>
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml"
              onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm"
            />
            <p className="text-xs text-muted-foreground">{t("logo.hint")}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="primary">{t("primary.label")}</Label>
            <div className="flex items-center gap-2">
              <input
                id="primary"
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-border"
              />
              <Input
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                pattern="^#[0-9a-fA-F]{6}$"
                className="max-w-[160px]"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="secondary">{t("secondary.label")}</Label>
            <div className="flex items-center gap-2">
              <input
                id="secondary"
                type="color"
                value={secondary || "#000000"}
                onChange={(e) => setSecondary(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-border"
              />
              <Input
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                placeholder="#hex (optional)"
                className="max-w-[160px]"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="subdomain">{t("subdomain.label")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="subdomain"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="my-clinic"
                disabled={!hasCustomSubdomain}
                pattern="^[a-z0-9-]{3,32}$"
                className="max-w-[260px]"
              />
              <span className="text-sm text-muted-foreground">
                .neurofax.uz
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {hasCustomSubdomain
                ? t("subdomain.dnsHint")
                : t("subdomain.upgradeRequired")}
            </p>
          </div>

          <div>
            <Button
              type="submit"
              disabled={save.isPending}
              className="gap-2"
            >
              {save.isPending ? (
                <UploadIcon className="size-4 animate-pulse" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              {save.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      )}
    </PageContainer>
  );
}
