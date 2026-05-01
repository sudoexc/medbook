"use client";

/**
 * Phase 9c — Billing page client (SUPER_ADMIN).
 *
 * Renders the current Subscription card, surface its feature flags, and offers
 * the four admin-override actions:
 *   - change plan          → PATCH  /api/admin/clinics/[id]/subscription
 *   - change status        → PATCH  /api/admin/clinics/[id]/subscription
 *   - extend trial (+30d)  → POST   /api/admin/clinics/[id]/subscription/extend-trial
 *   - cancel (soft)        → POST   /api/admin/clinics/[id]/subscription/cancel
 *
 * On every successful mutation we call `router.refresh()` so the SSR'd
 * subscription/plan data is re-fetched. Toasts surface success/failure.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  XIcon,
  RefreshCwIcon,
  CalendarPlusIcon,
  BanIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { ClinicTabs } from "../../_components/clinic-tabs";

/**
 * Local copy of `parsePlanFeatures` from `src/lib/feature-flags.ts` — the
 * server module imports `@/lib/prisma`, which can't ship to the browser. We
 * mirror the same defensive shape so the visible feature list stays in lock-
 * step with the server's `getFeatureFlags()` resolution. Phase 9d may extract
 * a tree-shakeable `feature-flags-shared.ts` once the gating UI lands.
 */
type FeatureFlags = {
  hasTelegramInbox: boolean;
  hasCallCenter: boolean;
  hasAnalyticsPro: boolean;
  maxBranches: number;
  maxUsers: number;
};

const DEFAULT_FLAGS: FeatureFlags = {
  hasTelegramInbox: false,
  hasCallCenter: false,
  hasAnalyticsPro: false,
  maxBranches: 1,
  maxUsers: 5,
};

function parsePlanFeatures(raw: unknown): FeatureFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_FLAGS };
  }
  const rec = raw as Record<string, unknown>;
  const pickBool = (key: keyof FeatureFlags): boolean => {
    const v = rec[key as string];
    return typeof v === "boolean" ? v : (DEFAULT_FLAGS[key] as boolean);
  };
  const pickInt = (key: keyof FeatureFlags): number => {
    const v = rec[key as string];
    return typeof v === "number" && Number.isFinite(v)
      ? v
      : (DEFAULT_FLAGS[key] as number);
  };
  return {
    hasTelegramInbox: pickBool("hasTelegramInbox"),
    hasCallCenter: pickBool("hasCallCenter"),
    hasAnalyticsPro: pickBool("hasAnalyticsPro"),
    maxBranches: pickInt("maxBranches"),
    maxUsers: pickInt("maxUsers"),
  };
}

type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

type SerializedPlan = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  priceMonth: string;
  currency: "UZS" | "USD";
  features: unknown;
  sortOrder: number;
};

type SerializedSubscription = {
  id: string;
  clinicId: string;
  planId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelledAt: string | null;
  plan: SerializedPlan;
};

interface InitialState {
  clinic: { id: string; slug: string; nameRu: string; nameUz: string };
  subscription: SerializedSubscription | null;
  plans: SerializedPlan[];
}

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIAL: "Trial",
  ACTIVE: "Активна",
  PAST_DUE: "Просрочена",
  CANCELLED: "Отменена",
};

const STATUS_BADGE: Record<SubscriptionStatus,
  "default" | "secondary" | "destructive" | "outline"> = {
  TRIAL: "secondary",
  ACTIVE: "default",
  PAST_DUE: "destructive",
  CANCELLED: "outline",
};

const FEATURE_LABEL: Record<keyof FeatureFlags, string> = {
  hasTelegramInbox: "Telegram-инбокс",
  hasCallCenter: "Колл-центр",
  hasAnalyticsPro: "Pro-аналитика",
  maxBranches: "Макс. филиалов",
  maxUsers: "Макс. пользователей",
};

function formatPrice(priceMonth: string, currency: string): string {
  const n = Number(priceMonth);
  if (!Number.isFinite(n)) return `${priceMonth} ${currency}`;
  // Format as integer with locale separators when whole, else 2dp.
  const formatter =
    Number.isInteger(n)
      ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 })
      : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
  return `${formatter.format(n)} ${currency} / мес.`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

export function BillingPageClient({ initial }: { initial: InitialState }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const sub = initial.subscription;
  const flags: FeatureFlags | null = sub
    ? parsePlanFeatures(sub.plan.features)
    : null;

  const callApi = React.useCallback(
    async (
      label: string,
      url: string,
      init: RequestInit,
      successMsg: string,
    ): Promise<boolean> => {
      setPendingAction(label);
      try {
        const r = await fetch(url, {
          ...init,
          headers: {
            "content-type": "application/json",
            ...(init.headers ?? {}),
          },
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => null)) as
            | { reason?: string; error?: string }
            | null;
          const msg = body?.reason ?? body?.error ?? `HTTP ${r.status}`;
          toast.error(msg);
          return false;
        }
        toast.success(successMsg);
        router.refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Network error");
        return false;
      } finally {
        setPendingAction(null);
      }
    },
    [router],
  );

  const onChangePlan = (newPlanId: string) => {
    if (!sub || newPlanId === sub.planId) return;
    void callApi(
      "plan",
      `/api/admin/clinics/${initial.clinic.id}/subscription`,
      { method: "PATCH", body: JSON.stringify({ planId: newPlanId }) },
      "План обновлён",
    );
  };

  const onChangeStatus = (newStatus: SubscriptionStatus) => {
    if (!sub || newStatus === sub.status) return;
    void callApi(
      "status",
      `/api/admin/clinics/${initial.clinic.id}/subscription`,
      { method: "PATCH", body: JSON.stringify({ status: newStatus }) },
      "Статус обновлён",
    );
  };

  const onExtendTrial = () =>
    callApi(
      "extend",
      `/api/admin/clinics/${initial.clinic.id}/subscription/extend-trial`,
      { method: "POST" },
      "Триал продлён на 30 дней",
    );

  const onCancel = () => {
    if (!confirm("Отменить подписку? Данные сохранятся (soft-cancel).")) return;
    void callApi(
      "cancel",
      `/api/admin/clinics/${initial.clinic.id}/subscription/cancel`,
      { method: "POST" },
      "Подписка отменена",
    );
  };

  const trialDaysLeft =
    sub?.trialEndsAt ? daysBetween(new Date(), new Date(sub.trialEndsAt)) : null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/admin/clinics"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Все клиники
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-foreground">
          Тарификация: {initial.clinic.nameRu}
        </h1>
        <p className="text-sm text-muted-foreground">
          Управление подпиской и тарифом клиники. Действия выполняются от имени SUPER_ADMIN
          и записываются в аудит-лог.
        </p>
      </div>

      <ClinicTabs clinicId={initial.clinic.id} />

      {!sub && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          У клиники нет активной подписки и каталог планов пуст. Запустите
          {" "}<code className="rounded bg-muted px-1">npx prisma migrate dev</code>{" "}
          чтобы засеять Plan-каталог, затем обновите страницу.
        </div>
      )}

      {sub && flags && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* ── Current plan card ── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Текущий тариф
                </div>
                <h2 className="mt-1 text-xl font-semibold text-foreground">
                  {sub.plan.nameRu}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {sub.plan.nameUz}
                  </span>
                </h2>
                <div className="mt-1 text-sm text-muted-foreground">
                  {formatPrice(sub.plan.priceMonth, sub.plan.currency)}
                </div>
              </div>
              <Badge variant={STATUS_BADGE[sub.status]}>
                {STATUS_LABEL[sub.status]}
              </Badge>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              {(
                ["hasTelegramInbox", "hasCallCenter", "hasAnalyticsPro"] as const
              ).map((key) => {
                const enabled = flags[key];
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2"
                  >
                    <span className="text-foreground">{FEATURE_LABEL[key]}</span>
                    {enabled ? (
                      <CheckIcon className="size-4 text-emerald-500" />
                    ) : (
                      <XIcon className="size-4 text-muted-foreground" />
                    )}
                  </div>
                );
              })}
              {(["maxBranches", "maxUsers"] as const).map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2"
                >
                  <span className="text-foreground">{FEATURE_LABEL[key]}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {flags[key]}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              {sub.status === "TRIAL" && (
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Триал до
                  </div>
                  <div className="font-medium text-foreground">
                    {formatDate(sub.trialEndsAt)}
                  </div>
                  {typeof trialDaysLeft === "number" && (
                    <div className="text-xs text-muted-foreground">
                      Осталось дней: {Math.max(0, trialDaysLeft)}
                    </div>
                  )}
                </div>
              )}
              {(sub.status === "ACTIVE" || sub.status === "PAST_DUE") && (
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Период до
                  </div>
                  <div className="font-medium text-foreground">
                    {formatDate(sub.currentPeriodEndsAt)}
                  </div>
                </div>
              )}
              {sub.status === "CANCELLED" && (
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Отменена
                  </div>
                  <div className="font-medium text-foreground">
                    {formatDate(sub.cancelledAt)}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Admin actions card ── */}
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">
              Действия SUPER_ADMIN
            </h2>
            <p className="text-xs text-muted-foreground">
              Все действия выполняются вручную (без Stripe / Payme). Подписка
              никогда не удаляется — отмена помечает строку как CANCELLED.
            </p>

            <div className="mt-4 space-y-4">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Сменить план
                </label>
                <Select
                  value={sub.planId}
                  onValueChange={onChangePlan}
                  disabled={pendingAction === "plan"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {initial.plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nameRu} · {formatPrice(p.priceMonth, p.currency)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Сменить статус (admin override)
                </label>
                <Select
                  value={sub.status}
                  onValueChange={(v) => onChangeStatus(v as SubscriptionStatus)}
                  disabled={pendingAction === "status"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELLED"] as const
                    ).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                <Button
                  variant="outline"
                  onClick={() => void onExtendTrial()}
                  disabled={pendingAction === "extend"}
                >
                  <CalendarPlusIcon />
                  {pendingAction === "extend"
                    ? "Продление…"
                    : "Продлить триал на 30 дней"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={onCancel}
                  disabled={
                    pendingAction === "cancel" || sub.status === "CANCELLED"
                  }
                >
                  <BanIcon />
                  {pendingAction === "cancel" ? "Отмена…" : "Отменить подписку"}
                </Button>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.refresh()}
                >
                  <RefreshCwIcon />
                  Обновить
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* All available plans (read-only summary) */}
      {sub && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">
            Каталог планов
          </h2>
          <p className="text-xs text-muted-foreground">
            Управление планами как сущностями — отдельная задача (Phase 9d+).
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {initial.plans.map((p) => {
              const planFlags = parsePlanFeatures(p.features);
              const isCurrent = p.id === sub.planId;
              return (
                <div
                  key={p.id}
                  className={
                    "rounded-md border p-3 text-sm " +
                    (isCurrent
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background/40")
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-foreground">
                      {p.nameRu}
                    </div>
                    {isCurrent && (
                      <Badge variant="default" className="text-[10px]">
                        Текущий
                      </Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {p.nameUz} · {formatPrice(p.priceMonth, p.currency)}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs">
                    <li className="flex items-center gap-1">
                      {planFlags.hasTelegramInbox ? (
                        <CheckIcon className="size-3 text-emerald-500" />
                      ) : (
                        <XIcon className="size-3 text-muted-foreground" />
                      )}
                      Telegram
                    </li>
                    <li className="flex items-center gap-1">
                      {planFlags.hasCallCenter ? (
                        <CheckIcon className="size-3 text-emerald-500" />
                      ) : (
                        <XIcon className="size-3 text-muted-foreground" />
                      )}
                      Колл-центр
                    </li>
                    <li className="flex items-center gap-1">
                      {planFlags.hasAnalyticsPro ? (
                        <CheckIcon className="size-3 text-emerald-500" />
                      ) : (
                        <XIcon className="size-3 text-muted-foreground" />
                      )}
                      Pro-аналитика
                    </li>
                    <li className="text-muted-foreground">
                      {planFlags.maxBranches} филиалов · {planFlags.maxUsers} юзеров
                    </li>
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
