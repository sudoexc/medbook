"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PlusIcon,
  PencilIcon,
  CreditCardIcon,
  LogInIcon,
  KeyRoundIcon,
  CopyIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  TimerIcon,
} from "lucide-react";

import {
  ClinicEntryDialog,
  type ClinicEntryTarget,
} from "@/components/layout/clinic-entry-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { postClinicEntry, type ClinicEntry } from "@/lib/clinic-entry";
import { cn } from "@/lib/utils";

interface ClinicRow {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  timezone: string;
  currency: "UZS" | "USD";
  secondaryCurrency: "UZS" | "USD" | null;
  active: boolean;
  phone: string | null;
  email: string | null;
  brandColor: string;
  createdAt: string;
  updatedAt: string;
  subscription?: {
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
    trialEndsAt: string | null;
    currentPeriodEndsAt: string | null;
    graceEndsAt: string | null;
    plan: { slug: string };
  } | null;
  _count?: { users: number; patients: number; appointments: number };
}

const SUB_LABEL: Record<NonNullable<ClinicRow["subscription"]>["status"], string> = {
  TRIAL: "Пробная",
  ACTIVE: "Активна",
  PAST_DUE: "Просрочена",
  CANCELLED: "Отменена",
};

/** Server refusals of the row menu, in words (audit G5-01). */
const LIFECYCLE_REASON: Record<string, string> = {
  subscription_active: "Подписка оплачена (ACTIVE): триал не продлевается",
  subscription_changed: "Подписку уже изменили, список обновлён",
  not_cancelled: "Восстановить можно только отменённую подписку",
  no_subscription: "У клиники нет подписки: создайте её в «Тарификации»",
};

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Tashkent",
  });
}

interface CreatedClinicResponse extends ClinicRow {
  ownerLogin: string;
  ownerTempPassword: string;
}

async function fetchClinics(): Promise<ClinicRow[]> {
  const r = await fetch("/api/platform/clinics", { cache: "no-store" });
  if (!r.ok) throw new Error("Failed to load clinics");
  const data = (await r.json()) as { clinics: ClinicRow[] };
  return data.clinics;
}

/** Mirrors PLAYBOOK_SLUGS in src/server/onboarding/playbooks (RU labels). */
const PLAYBOOK_OPTIONS = [
  { value: "general", label: "Многопрофильная клиника" },
  { value: "dental", label: "Стоматология" },
  { value: "neurology", label: "Неврология" },
  { value: "pediatric", label: "Педиатрия" },
  { value: "cosmetology", label: "Косметология" },
] as const;

type PlaybookValue = (typeof PLAYBOOK_OPTIONS)[number]["value"];

async function createClinic(input: {
  slug: string;
  nameRu: string;
  nameUz: string;
  timezone: string;
  currency: "UZS";
  ownerName: string;
  ownerEmail: string;
  active: boolean;
  playbook: PlaybookValue | null;
  planSlug: string;
  trialDays: number;
}): Promise<CreatedClinicResponse> {
  const r = await fetch("/api/platform/clinics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as
      | { reason?: string; error?: string; issues?: { path: (string | number)[]; message: string }[] }
      | null;
    if (body?.reason) throw new Error(body.reason);
    if (body?.issues?.length) {
      const first = body.issues[0];
      const field = first?.path?.join(".") || "";
      throw new Error(field ? `${field}: ${first?.message}` : (first?.message ?? "ValidationError"));
    }
    throw new Error(body?.error ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as CreatedClinicResponse;
}

async function patchClinic(
  id: string,
  patch: Partial<ClinicRow>,
): Promise<void> {
  const r = await fetch(`/api/platform/clinics/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

interface ClinicAdmin {
  id: string;
  name: string | null;
  email: string;
}

/** Refusals of the owner password reset, in words. */
const RESET_OWNER_REASON: Record<string, string> = {
  no_active_owner: "В клинике нет активного администратора: посмотрите в «Пользователях»",
  owner_not_admin: "Эта учётка больше не активный администратор клиники, список обновлён",
};

async function fetchClinicAdmins(clinicId: string): Promise<ClinicAdmin[]> {
  const r = await fetch(
    `/api/platform/clinics/${clinicId}/reset-owner-password`,
    { cache: "no-store" },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { admins: ClinicAdmin[] };
  return data.admins;
}

async function resetOwnerPassword(
  clinicId: string,
  userId: string,
): Promise<{ ownerLogin: string; ownerTempPassword: string }> {
  const r = await fetch(
    `/api/platform/clinics/${clinicId}/reset-owner-password`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    },
  );
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { reason?: string } | null;
    const reason = body?.reason ?? `HTTP ${r.status}`;
    throw new Error(RESET_OWNER_REASON[reason] ?? reason);
  }
  return (await r.json()) as { ownerLogin: string; ownerTempPassword: string };
}

async function impersonateClinic(
  clinicId: string,
  entry: ClinicEntry,
): Promise<void> {
  // Phase 19 W4 — switch-clinic requires a reason (≥4 chars) and a mode, both
  // asked in ClinicEntryDialog with read-only preselected; Cancel sends
  // nothing (audit CM-21). A failure is thrown back into the dialog.
  await postClinicEntry(clinicId, entry);
  window.location.href = "/ru/crm";
}

async function lifecycleAction(
  clinicId: string,
  action: "suspend" | "restore" | "extend-trial",
  expectedTrialEndsAt?: string | null,
): Promise<{ status?: string; trialEndsAt?: string | null }> {
  const r = await fetch(`/api/admin/clinics/${clinicId}/lifecycle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      action === "extend-trial"
        ? { action, expectedTrialEndsAt: expectedTrialEndsAt ?? null }
        : { action },
    ),
  });
  const body = (await r.json().catch(() => null)) as {
    reason?: string;
    error?: string;
    subscription?: { status?: string; trialEndsAt?: string | null };
  } | null;
  if (!r.ok) {
    const reason = body?.reason ?? body?.error ?? `HTTP ${r.status}`;
    throw new Error(LIFECYCLE_REASON[reason] ?? reason);
  }
  return body?.subscription ?? {};
}

export function ClinicsPageClient({ expired = false }: { expired?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "clinics"],
    queryFn: fetchClinics,
  });
  const [creating, setCreating] = React.useState(false);
  const [credsModal, setCredsModal] = React.useState<{
    title: string;
    login: string;
    password: string;
  } | null>(null);
  const [entering, setEntering] = React.useState<ClinicEntryTarget | null>(
    null,
  );
  // The clinic whose owner password is about to be reset (audit G5-07).
  const [resetFor, setResetFor] = React.useState<ClinicRow | null>(null);

  const toggleActive = useMutation({
    mutationFn: (row: ClinicRow) => patchClinic(row.id, { active: !row.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "clinics"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const resetPwd = useMutation({
    mutationFn: (input: { clinicId: string; userId: string }) =>
      resetOwnerPassword(input.clinicId, input.userId),
    onSuccess: (res) => {
      setResetFor(null);
      setCredsModal({
        title: "Пароль сброшен",
        login: res.ownerLogin,
        password: res.ownerTempPassword,
      });
    },
    onError: (e, input) => {
      toast.error(e instanceof Error ? e.message : "Error");
      void qc.invalidateQueries({
        queryKey: ["admin", "clinic-admins", input.clinicId],
      });
    },
  });

  // Phase 19 W4 — bulk lifecycle ops (suspend / restore / extend trial).
  const lifecycle = useMutation({
    mutationFn: (input: {
      clinicId: string;
      action: "suspend" | "restore" | "extend-trial";
      expectedTrialEndsAt?: string | null;
    }) =>
      lifecycleAction(input.clinicId, input.action, input.expectedTrialEndsAt),
    onSuccess: (sub, input) => {
      // What the server saved, not what the button hoped for (audit G5-01).
      const status =
        sub.status && sub.status in SUB_LABEL
          ? SUB_LABEL[sub.status as keyof typeof SUB_LABEL]
          : "";
      const message =
        input.action === "suspend"
          ? "Подписка отменена"
          : input.action === "restore"
            ? `Подписка восстановлена: ${status}`
            : `Пробный период до ${shortDate(sub.trialEndsAt)}`;
      toast.success(message);
      void qc.invalidateQueries({ queryKey: ["admin", "clinics"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Error");
      void qc.invalidateQueries({ queryKey: ["admin", "clinics"] });
    },
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Клиники</h1>
          <p className="text-sm text-muted-foreground">
            Всего: {data?.length ?? 0}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon />
          Новая клиника
        </Button>
      </div>

      {expired && (
        // The 60 minute lease of a clinic visit ran out (audit G5-09): the
        // CRM sent the operator back here instead of leaving them in a CRM
        // without a clinic.
        <div
          role="status"
          className="rounded-lg border border-warning/40 bg-warning/15 p-4 text-sm text-foreground"
        >
          Время входа в клинику (60 минут) истекло, доступ к её данным закрыт.
          Чтобы продолжить работу, войдите в клинику снова.
        </div>
      )}
      {isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Загрузка…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error instanceof Error ? error.message : "Error"}
        </div>
      )}
      {!isLoading && !error && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="p-3 font-medium">Слаг</th>
                <th className="p-3 font-medium">Название (RU)</th>
                <th className="p-3 font-medium">Название (UZ)</th>
                <th className="p-3 font-medium">Timezone</th>
                <th className="p-3 font-medium">Валюта</th>
                <th className="p-3 font-medium">Счётчики</th>
                <th className="p-3 font-medium">Подписка</th>
                <th className="p-3 font-medium">Активна</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data?.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30"
                >
                  <td className="p-3 font-mono text-xs">{c.slug}</td>
                  <td className="p-3 font-medium">{c.nameRu}</td>
                  <td className="p-3 text-muted-foreground">{c.nameUz}</td>
                  <td className="p-3 text-muted-foreground">{c.timezone}</td>
                  <td className="p-3">
                    <Badge variant="secondary">{c.currency}</Badge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    users {c._count?.users ?? 0} · patients{" "}
                    {c._count?.patients ?? 0} · appts{" "}
                    {c._count?.appointments ?? 0}
                  </td>
                  <td className="p-3 text-xs">
                    {c.subscription ? (
                      <div className="space-y-0.5">
                        <Badge
                          variant={
                            c.subscription.status === "PAST_DUE" ||
                            c.subscription.status === "CANCELLED"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {SUB_LABEL[c.subscription.status]} ·{" "}
                          {c.subscription.plan.slug}
                        </Badge>
                        <div className="text-muted-foreground">
                          {c.subscription.status === "TRIAL"
                            ? `до ${shortDate(c.subscription.trialEndsAt)}`
                            : c.subscription.status === "PAST_DUE"
                              ? `льгота до ${shortDate(c.subscription.graceEndsAt)}`
                              : c.subscription.status === "ACTIVE"
                                ? c.subscription.currentPeriodEndsAt
                                  ? `до ${shortDate(c.subscription.currentPeriodEndsAt)}`
                                  : "бессрочно"
                                : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">нет подписки</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Switch
                      checked={c.active}
                      title="Выключенная клиника: сотрудники не могут войти, у пациентов не работают мини-апп, киоск, ТВ-табло и запись с сайта"
                      onCheckedChange={() => {
                        // Switching off locks the clinic's staff out (audit
                        // SEC-10) and stops every patient-facing channel
                        // (audit G5-10), so it is confirmed with the full
                        // list; switching on is not.
                        if (
                          c.active &&
                          !window.confirm(
                            `Выключить клинику «${c.nameRu}»?\n\nПока её не включат снова:\n• сотрудники клиники не смогут войти;\n• у пациентов перестанет работать мини-апп;\n• киоск в холле не даст отметиться;\n• ТВ-табло очереди и экраны у кабинетов погаснут;\n• запись с сайта перестанет приниматься.`,
                          )
                        ) {
                          return;
                        }
                        toggleActive.mutate(c);
                      }}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* A switched-off clinic can be entered too (owner
                          request 09.10.2026): the dialog warns that its
                          staff and patients cannot see it and sends
                          `breakGlass`. */}
                      <Button
                        variant={c.active ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          setEntering({
                            id: c.id,
                            name: c.nameRu,
                            inactive: !c.active,
                          })
                        }
                      >
                        <LogInIcon />
                        Войти
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResetFor(c)}
                        disabled={
                          resetPwd.isPending &&
                          resetPwd.variables?.clinicId === c.id
                        }
                      >
                        <KeyRoundIcon />
                        Пароль владельца
                      </Button>
                      <Link
                        href={`/admin/clinics/${c.id}/billing`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        <CreditCardIcon />
                        Тарификация
                      </Link>
                      <Link
                        href={`/admin/clinics/${c.id}/integrations`}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                        )}
                      >
                        <PencilIcon />
                        Интеграции
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label="Действия с клиникой"
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          {c.subscription &&
                          c.subscription.status !== "CANCELLED" ? (
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                if (
                                  window.confirm(
                                    `Отменить подписку «${c.nameRu}»? Pro-функции отключатся, лимиты станут как у Basic. Вход сотрудников не блокируется: для этого выключите клинику.`,
                                  )
                                ) {
                                  lifecycle.mutate({
                                    clinicId: c.id,
                                    action: "suspend",
                                  });
                                }
                              }}
                              className="gap-2 text-destructive focus:text-destructive"
                            >
                              <PauseIcon className="size-4" />
                              Отменить подписку
                            </DropdownMenuItem>
                          ) : null}
                          {c.subscription?.status === "CANCELLED" ? (
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e.preventDefault();
                                if (
                                  window.confirm(
                                    `Восстановить подписку «${c.nameRu}» в том виде, в каком она была до отмены?`,
                                  )
                                ) {
                                  lifecycle.mutate({
                                    clinicId: c.id,
                                    action: "restore",
                                  });
                                }
                              }}
                              className="gap-2"
                            >
                              <PlayIcon className="size-4" />
                              Восстановить подписку
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={
                              !c.subscription ||
                              c.subscription.status === "ACTIVE"
                            }
                            onSelect={(e) => {
                              e.preventDefault();
                              if (
                                window.confirm(
                                  `Продлить пробный период «${c.nameRu}» на 30 дней?`,
                                )
                              ) {
                                lifecycle.mutate({
                                  clinicId: c.id,
                                  action: "extend-trial",
                                  expectedTrialEndsAt:
                                    c.subscription?.trialEndsAt ?? null,
                                });
                              }
                            }}
                            className="gap-2"
                          >
                            <TimerIcon className="size-4" />
                            Пробный +30 дней
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    Нет клиник. Создайте первую.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <CreateClinicDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(res) => {
          qc.invalidateQueries({ queryKey: ["admin", "clinics"] });
          setCredsModal({
            title: "Клиника создана",
            login: res.ownerLogin,
            password: res.ownerTempPassword,
          });
        }}
      />

      <ResetOwnerDialog
        clinic={resetFor}
        pending={resetPwd.isPending}
        onClose={() => setResetFor(null)}
        onConfirm={(userId) => {
          if (resetFor) resetPwd.mutate({ clinicId: resetFor.id, userId });
        }}
      />

      <CredentialsModal
        creds={credsModal}
        onClose={() => setCredsModal(null)}
      />

      <ClinicEntryDialog
        target={entering}
        onCancel={() => setEntering(null)}
        onEnter={impersonateClinic}
      />
    </div>
  );
}

/**
 * Whose password «Пароль владельца» resets, said before it happens (audit
 * G5-07). The schema has no owner flag, so the clinic's active ADMIN
 * accounts are listed by name and email, the oldest (the usual owner)
 * picked by default.
 */
function ResetOwnerDialog({
  clinic,
  pending,
  onClose,
  onConfirm,
}: {
  clinic: ClinicRow | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (userId: string) => void;
}) {
  const admins = useQuery({
    queryKey: ["admin", "clinic-admins", clinic?.id],
    queryFn: () => fetchClinicAdmins(clinic!.id),
    enabled: !!clinic,
  });
  // The pick belongs to one clinic: another clinic starts from its default.
  const [pick, setPick] = React.useState<{ clinicId: string; userId: string } | null>(
    null,
  );
  const pickedId = pick && pick.clinicId === clinic?.id ? pick.userId : null;
  // The oldest account until another is picked; a pick that fell off a
  // refreshed list falls back to it too.
  const chosen =
    admins.data?.find((a) => a.id === pickedId) ?? admins.data?.[0] ?? null;
  const close = () => {
    setPick(null);
    onClose();
  };

  return (
    <Dialog open={!!clinic} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Сбросить пароль администратора</DialogTitle>
          <DialogDescription>
            Клиника «{clinic?.nameRu}». Текущий пароль выбранной учётки
            перестанет работать, её сеансы завершатся. Новый временный пароль
            покажем один раз.
          </DialogDescription>
        </DialogHeader>
        {admins.isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : admins.error ? (
          <p className="text-sm text-destructive">
            {admins.error instanceof Error ? admins.error.message : "Error"}
          </p>
        ) : !admins.data?.length ? (
          <p className="text-sm text-muted-foreground">
            В клинике нет активного администратора. Назначьте его в разделе
            «Пользователи».
          </p>
        ) : (
          <RadioGroup
            value={chosen?.id ?? ""}
            onValueChange={(userId) =>
              clinic && setPick({ clinicId: clinic.id, userId })
            }
            className="gap-1"
          >
            {admins.data.map((a, i) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 hover:bg-muted/40"
              >
                <RadioGroupItem value={a.id} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">
                    {a.name || a.email}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.email}
                  </span>
                </span>
                {i === 0 ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    создан первым
                  </Badge>
                ) : null}
              </label>
            ))}
          </RadioGroup>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            disabled={!chosen || pending}
            onClick={() => chosen && onConfirm(chosen.id)}
          >
            {pending
              ? "Сброс…"
              : chosen
                ? `Сбросить пароль ${chosen.email}`
                : "Сбросить пароль"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateClinicDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (res: CreatedClinicResponse) => void;
}) {
  const [slug, setSlug] = React.useState("");
  const [nameRu, setNameRu] = React.useState("");
  const [nameUz, setNameUz] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Tashkent");
  const [ownerName, setOwnerName] = React.useState("");
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState<string | null>(null);
  // "none" = start blank (no seeded services/templates).
  const [playbook, setPlaybook] = React.useState<PlaybookValue | "none">("none");
  // The subscription is created with the clinic (audit G5-03).
  const [planSlug, setPlanSlug] = React.useState("pro");
  const [trialDays, setTrialDays] = React.useState("30");
  const plans = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: async () => {
      const r = await fetch("/api/admin/plans", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as {
        plans: Array<{ id: string; slug: string; nameRu: string }>;
      };
      return data.plans;
    },
    enabled: open,
  });
  const trialDaysNum = Number(trialDays);
  const trialDaysValid =
    Number.isInteger(trialDaysNum) && trialDaysNum >= 1 && trialDaysNum <= 365;

  const reset = () => {
    setSlug("");
    setNameRu("");
    setNameUz("");
    setOwnerName("");
    setOwnerEmail("");
    setEmailError(null);
    setPlaybook("none");
    setPlanSlug("pro");
    setTrialDays("30");
  };

  const mut = useMutation({
    mutationFn: () =>
      createClinic({
        slug: slug.trim(),
        nameRu: nameRu.trim(),
        nameUz: nameUz.trim(),
        timezone,
        currency: "UZS",
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim().toLowerCase(),
        active: true,
        playbook: playbook === "none" ? null : playbook,
        planSlug,
        trialDays: trialDaysNum,
      }),
    onSuccess: (res) => {
      toast.success("Клиника создана");
      onCreated(res);
      onOpenChange(false);
      reset();
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "Error";
      if (msg === "email_taken") {
        setEmailError("Email уже используется другим аккаунтом");
      } else if (msg === "slug_taken") {
        toast.error("Слаг уже занят");
      } else {
        toast.error(msg);
      }
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Новая клиника</DialogTitle>
          <DialogDescription>
            Будет создана клиника и аккаунт владельца с ролью ADMIN. Временный
            пароль покажем один раз — сохраните его сразу.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="slug">Слаг</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="neurofax"
            />
            <p className="text-xs text-muted-foreground">
              Нельзя изменить позже. a-z, 0-9, дефис.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nameRu">Название (RU)</Label>
              <Input
                id="nameRu"
                value={nameRu}
                onChange={(e) => setNameRu(e.target.value)}
                placeholder="Нейрофакс"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nameUz">Название (UZ)</Label>
              <Input
                id="nameUz"
                value={nameUz}
                onChange={(e) => setNameUz(e.target.value)}
                placeholder="Neyrofaks"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="tz">Timezone</Label>
              <Input
                id="tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Валюта</Label>
              <Input value="UZS" readOnly className="text-muted-foreground" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Плейбук специализации</Label>
            <Select
              value={playbook}
              onValueChange={(v) => setPlaybook(v as PlaybookValue | "none")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без плейбука (пустая клиника)</SelectItem>
                {PLAYBOOK_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Плейбук сразу создаст типовые услуги, шаблоны уведомлений
              (подтверждение + напоминания) и график работы. «Без плейбука» —
              клиника начнёт с нуля, шаблоны придётся заводить вручную.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Тариф пробного периода</Label>
              <Select value={planSlug} onValueChange={setPlanSlug}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(plans.data ?? [{ id: "pro", slug: "pro", nameRu: "Pro" }]).map(
                    (p) => (
                      <SelectItem key={p.id} value={p.slug}>
                        {p.nameRu}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="trialDays">Пробный период, дней</Label>
              <Input
                id="trialDays"
                type="number"
                min={1}
                max={365}
                value={trialDays}
                onChange={(e) => setTrialDays(e.target.value)}
                aria-invalid={trialDaysValid ? undefined : true}
              />
            </div>
          </div>

          <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium">Владелец клиники (ADMIN)</p>
              <p className="text-xs text-muted-foreground">
                Сможет настраивать клинику и приглашать остальной персонал.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ownerName">ФИО</Label>
                <Input
                  id="ownerName"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Иван Петров"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ownerEmail">Email</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => {
                    setOwnerEmail(e.target.value);
                    if (emailError) setEmailError(null);
                  }}
                  placeholder="ivan@example.com"
                  aria-invalid={emailError ? true : undefined}
                />
                {emailError && (
                  <p className="text-xs text-destructive">{emailError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={
              mut.isPending ||
              !slug.trim() ||
              !nameRu.trim() ||
              !nameUz.trim() ||
              !ownerName.trim() ||
              !ownerEmail.trim() ||
              !ownerEmail.includes("@") ||
              !trialDaysValid
            }
          >
            {mut.isPending ? "Создание…" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsModal({
  creds,
  onClose,
}: {
  creds: { title: string; login: string; password: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = React.useState<"login" | "password" | "both" | null>(
    null,
  );

  React.useEffect(() => {
    if (!creds) setCopied(null);
  }, [creds]);

  if (!creds) return null;

  const copy = async (
    text: string,
    kind: "login" | "password" | "both",
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Скопировать не удалось");
    }
  };

  return (
    <Dialog
      open
      // Closes only via «Я сохранил, закрыть» (audit G5-07). Esc and a click
      // beside the window used to close it too, and the one-time password
      // was gone: getting it back meant resetting the password again.
      disablePointerDismissal
      onOpenChange={() => {}}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{creds.title}</DialogTitle>
          <DialogDescription>
            Это единственный раз, когда вы видите временный пароль. Передайте
            его владельцу — при первом входе он сменит пароль на свой.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <CredRow
            label="Логин"
            value={creds.login}
            copied={copied === "login"}
            onCopy={() => copy(creds.login, "login")}
          />
          <CredRow
            label="Временный пароль"
            value={creds.password}
            mono
            copied={copied === "password"}
            onCopy={() => copy(creds.password, "password")}
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() =>
              copy(`${creds.login}\n${creds.password}`, "both")
            }
          >
            {copied === "both" ? <CheckIcon /> : <CopyIcon />}
            Скопировать оба
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Я сохранил, закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredRow({
  label,
  value,
  copied,
  mono,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  mono?: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          value={value}
          readOnly
          className={mono ? "font-mono" : undefined}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button variant="outline" size="icon" onClick={onCopy} aria-label="Скопировать">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
    </div>
  );
}
