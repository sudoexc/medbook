"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOutIcon } from "lucide-react";

import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { Button } from "@/components/ui/button";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  clinics: { title: "Клиники", subtitle: "CRUD платформы" },
  users: { title: "Пользователи", subtitle: "Глобальный список" },
  usage: { title: "Использование", subtitle: "Агрегаты за период" },
  audit: { title: "Аудит", subtitle: "Журнал действий всех клиник" },
  health: { title: "Здоровье", subtitle: "Состояние сервисов" },
  // Without it the fallback below titled this page «Клиники» (audit G5-08).
  "encryption-health": {
    title: "Шифрование",
    subtitle: "Ключи и зашифрованные поля",
  },
};

interface AdminTopbarProps {
  userName: string | null;
  userEmail: string | null;
}

export function AdminTopbar({ userName, userEmail }: AdminTopbarProps) {
  const pathname = usePathname() ?? "";
  const segment = pathname.split("/").filter(Boolean)[1] ?? "clinics";
  const meta = TITLES[segment] ?? TITLES.clinics!;

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold leading-tight text-foreground">
          {meta.title}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {meta.subtitle}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right md:block">
          <div className="text-sm font-medium text-foreground">
            {userName ?? "Platform admin"}
          </div>
          <div className="text-xs text-muted-foreground">
            {userEmail ?? ""}
          </div>
        </div>
        <AvatarWithStatus
          name={userName ?? userEmail ?? "Admin"}
          status="online"
          size="sm"
        />
        {/* The most privileged account had no way out of /admin (audit
            G5-08): the operator had to go to the CRM to find «Выйти». */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void signOut({ callbackUrl: "/login" })}
          className="text-destructive hover:text-destructive"
        >
          <LogOutIcon className="size-4" />
          Выйти
        </Button>
      </div>
    </header>
  );
}
