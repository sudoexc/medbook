"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  XCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import { useDoctorSecuritySummary } from "../_hooks/use-doctor-security-summary";

function fmtDateRu(iso: string | null): string {
  if (!iso) return "никогда";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SecurityTab({ locale }: { locale: string }) {
  const sec = useDoctorSecuritySummary();

  if (sec.isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (sec.isError || !sec.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-destructive">
        Не удалось загрузить статус безопасности.
      </div>
    );
  }

  const d = sec.data;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-1 text-sm font-semibold text-foreground">
          Статус безопасности
        </div>
        <p className="mb-5 text-xs text-muted-foreground">
          Управление паролем, 2FA и сессиями — в разделе «Моя безопасность».
          Здесь показываем только статус.
        </p>

        <ul className="space-y-2">
          <Row
            ok={d.passwordSet && !d.mustChangePassword}
            okText="Пароль установлен"
            warnText={
              d.mustChangePassword
                ? "Требуется смена пароля"
                : "Пароль не задан"
            }
            icon={KeyRoundIcon}
          />
          <Row
            ok={d.twoFactorEnabled}
            okText="Двухфакторная авторизация включена"
            warnText="Двухфакторная авторизация выключена"
            icon={d.twoFactorEnabled ? ShieldCheckIcon : ShieldOffIcon}
          />
          <li className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
            <span className="text-foreground">Активные сессии</span>
            <span className="font-semibold tabular-nums">
              {d.activeSessions}
            </span>
          </li>
          <li className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-sm">
            <span className="text-foreground">Последний вход</span>
            <span className="text-muted-foreground">
              {fmtDateRu(d.lastLoginAt)}
            </span>
          </li>
        </ul>

        <Link
          href={`/${locale}/crm/me/security`}
          className="motion-press mt-5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Перейти в настройки безопасности
          <ArrowRightIcon className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function Row({
  ok,
  okText,
  warnText,
  icon: Icon,
}: {
  ok: boolean;
  okText: string;
  warnText: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        ok
          ? "bg-success/10 text-success"
          : "bg-warning/10 text-warning",
      )}
    >
      {ok ? (
        <CheckCircle2Icon className="size-4 shrink-0" />
      ) : (
        <XCircleIcon className="size-4 shrink-0" />
      )}
      <Icon className="size-4 shrink-0 opacity-70" />
      <span className="font-medium">{ok ? okText : warnText}</span>
    </li>
  );
}
