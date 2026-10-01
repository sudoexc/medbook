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
 * and, for a clinic without one, «Создать подписку» → POST
 * /api/admin/clinics/[id]/subscription (audit G5-03: nothing is created
 * implicitly any more).
 *
 * Extending a trial is the shared rule (audit G5-01): PAST_DUE and CANCELLED
 * come back to TRIAL, ACTIVE is refused, and the toast reports the status and
 * date the server actually saved, not a fixed «продлён».
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
  graceEndsAt: string | null;
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

/** Server refusals the owner can act on, in words. */
const REASON_LABEL: Record<string, string> = {
  subscription_active: "Подписка оплачена (ACTIVE): триал не продлевается",
  subscription_changed: "Подписку уже изменили. Страница обновлена, проверьте",
  not_cancelled: "Восстановить можно только отменённую подписку",
  no_subscription: "У клиники нет подписки",
  subscription_exists: "Подписка уже есть",
  invalid_plan: "План не найден или отключён",
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

export function BillingPageClient({
  initial,
  defaultTrialDays,
}: {
  initial: InitialState;
  defaultTrialDays: number;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const [newPlanId, setNewPlanId] = React.useState<string>(
    () =>
      initial.plans.find((p) => p.slug === "pro")?.id ??
      initial.plans[0]?.id ??
      "",
  );
  const [newTrialDays, setNewTrialDays] = React.useState(String(defaultTrialDays));
  const sub = initial.subscription;
  const flags: FeatureFlags | null = sub
    ? parsePlanFeatures(sub.plan.features)
    : null;

  const callApi = React.useCallback(
    async (
      label: string,
      url: string,
      init: RequestInit,
      successMsg: string | ((body: unknown) => string),
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
          const reason = body?.reason ?? body?.error ?? `HTTP ${r.status}`;
          toast.error(REASON_LABEL[reason] ?? reason);
          // A stale page (someone else changed it): show the real state.
          if (r.status === 409) router.refresh();
          return false;
        }
        const okBody = (await r.json().catch(() => null)) as unknown;
        toast.success(
          typeof successMsg === "function" ? successMsg(okBody) : successMsg,
        );
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
      {
        method: "POST",
        // The date on screen: a second click finds it changed and gets 409.
        body: JSON.stringify({ expectedTrialEndsAt: sub?.trialEndsAt ?? null }),
      },
      (body) => {
        const s = (body as { subscription?: SerializedSubscription } | null)
          ?.subscription;
        return s
          ? `${STATUS_LABEL[s.status]} до ${formatDate(s.trialEndsAt)}`
          : "Готово";
      },
    );

  const onCreate = () => {
    const days = Number(newTrialDays);
    if (!newPlanId || !Number.isInteger(days) || days < 1 || days > 365) {
      toast.error("Укажите план и срок триала от 1 до 365 дней");
      return;
    }
    void callApi(
      "create",
      `/api/admin/clinics/${initial.clinic.id}/subscription`,
      {
        method: "POST",
        body: JSON.stringify({ planId: newPlanId, trialDays: days }),
      },
      "Подписка создана",
    );
  };

  const onCancel = () => {
    if (
      !confirm(
        "Отменить подписку? Pro-функции отключатся, лимиты станут как у Basic. Данные сохранятся, «Восстановить» вернёт прежний статус.",
      )
    )
      return;
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

      {!sub && initial.plans.length === 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          У клиники нет подписки и каталог планов пуст. Запустите
          {" "}<code className="rounded bg-muted px-1">npx prisma migrate dev</code>{" "}
          чтобы засеять Plan-каталог, затем обновите страницу.
        </div>
      )}

      {!sub && initial.plans.length > 0 && (
        <div className="max-w-xl space-y-3 rounded-lg border border-border bg-card p-5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              У клиники нет подписки
            </h2>
            <p className="text-xs text-muted-foreground">
              Пока подписки нет, клиника работает на функциях Basic. Создайте
              пробный период на нужном плане.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                План
              </label>
              <Select value={newPlanId} onValueChange={setNewPlanId}>
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
                Пробный период, дней
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={newTrialDays}
                onChange={(e) => setNewTrialDays(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-3 text-sm"
              />
            </div>
          </div>
          <Button onClick={onCreate} disabled={pendingAction === "create"}>
            {pendingAction === "create" ? "Создание…" : "Создать подписку"}
          </Button>
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
              {sub.status === "ACTIVE" && (
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Оплачено до
                  </div>
                  <div className="font-medium text-foreground">
                    {sub.currentPeriodEndsAt
                      ? formatDate(sub.currentPeriodEndsAt)
                      : "Бессрочно"}
                  </div>
                </div>
              )}
              {sub.status === "PAST_DUE" && (
                <div className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">
                    Льготный период до
                  </div>
                  <div className="font-medium text-foreground">
                    {formatDate(sub.graceEndsAt)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Потом подписка отменится автоматически
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
                  disabled={pendingAction === "extend" || sub.status === "ACTIVE"}
                  title={
                    sub.status === "ACTIVE"
                      ? "Подписка оплачена, триал продлевать не нужно"
                      : undefined
                  }
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
