"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CoinsIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { settingsFetch } from "../../_hooks/use-settings-api";

type ExchangeRate = {
  id: string;
  date: string;
  rateUsd: string | number;
  source: string | null;
  createdAt: string;
};

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function ExchangeRatesClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["settings", "exchange-rates"],
    queryFn: () =>
      settingsFetch<{ rows: ExchangeRate[] }>(
        "/api/crm/exchange-rates?limit=100",
      ),
  });

  const [form, setForm] = React.useState({
    date: todayIso(),
    rateUsd: "",
    source: "",
  });

  const mut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/exchange-rates", {
        method: "POST",
        body: JSON.stringify({
          date: form.date,
          rateUsd: form.rateUsd,
          source: form.source || null,
        }),
      }),
    onSuccess: () => {
      toast.success(t("exchangeRates.saved"));
      setForm({ date: todayIso(), rateUsd: "", source: "" });
      qc.invalidateQueries({ queryKey: ["settings", "exchange-rates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQuery.data?.rows ?? [];

  return (
    <PageContainer>
      <SectionHeader
        title={t("exchangeRates.title")}
        subtitle={t("exchangeRates.subtitle")}
      />

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-2 pb-3">
          <CoinsIcon className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">
            {t("exchangeRates.addDaily")}
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="fx-date">{t("exchangeRates.cols.date")}</Label>
            <Input
              id="fx-date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="fx-rate">{t("exchangeRates.cols.rate")}</Label>
            <Input
              id="fx-rate"
              type="number"
              step="0.0001"
              min="0"
              placeholder="12600"
              value={form.rateUsd}
              onChange={(e) => setForm({ ...form, rateUsd: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="fx-source">
              {t("exchangeRates.cols.source")}
            </Label>
            <Input
              id="fx-source"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="CBU, manual..."
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => mut.mutate()}
              disabled={mut.isPending || !form.rateUsd}
              className="w-full"
            >
              <PlusIcon className="size-4" />
              {t("exchangeRates.save")}
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">
                {t("exchangeRates.cols.date")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("exchangeRates.cols.rate")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("exchangeRates.cols.source")}
              </th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  {t("exchangeRates.empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {new Date(r.date).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {String(r.rateUsd)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.source ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </PageContainer>
  );
}
