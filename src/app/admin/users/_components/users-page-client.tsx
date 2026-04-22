"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";

type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  clinicId: string | null;
  clinic: { id: string; slug: string; nameRu: string } | null;
  createdAt: string;
}

interface UsersResp {
  rows: UserRow[];
  nextCursor: string | null;
}

interface ClinicOption {
  id: string;
  slug: string;
  nameRu: string;
}

const ROLES: Role[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
];

async function fetchUsers(
  q: string,
  role: string,
  clinicId: string,
): Promise<UsersResp> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (role) params.set("role", role);
  if (clinicId) params.set("clinicId", clinicId);
  const r = await fetch(`/api/platform/users?${params.toString()}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as UsersResp;
}

async function fetchClinics(): Promise<ClinicOption[]> {
  const r = await fetch("/api/platform/clinics", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { clinics: ClinicOption[] };
  return data.clinics;
}

async function patchUser(
  id: string,
  patch: { clinicId?: string | null; role?: Role; active?: boolean },
): Promise<void> {
  const r = await fetch(`/api/platform/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const b = (await r.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(b?.reason ?? `HTTP ${r.status}`);
  }
}

export function UsersPageClient() {
  const qc = useQueryClient();
  const [q, setQ] = React.useState("");
  const [role, setRole] = React.useState<"" | Role>("");
  const [clinicFilter, setClinicFilter] = React.useState<string>("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [reassign, setReassign] = React.useState<UserRow | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const users = useQuery({
    queryKey: ["admin", "users", debouncedQ, role, clinicFilter],
    queryFn: () => fetchUsers(debouncedQ, role, clinicFilter),
  });

  const clinics = useQuery({
    queryKey: ["admin", "clinics", "options"],
    queryFn: fetchClinics,
  });

  const deactivate = useMutation({
    mutationFn: (u: UserRow) => patchUser(u.id, { active: !u.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Email, имя, телефон"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as "" | Role)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Все роли" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Все роли</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={clinicFilter} onValueChange={setClinicFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Все клиники" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Все клиники</SelectItem>
            {clinics.data?.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nameRu}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {users.isLoading && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Загрузка…
        </div>
      )}
      {users.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {users.error instanceof Error ? users.error.message : "Error"}
        </div>
      )}
      {users.data && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                <th className="p-3 font-medium">Пользователь</th>
                <th className="p-3 font-medium">Роль</th>
                <th className="p-3 font-medium">Клиника</th>
                <th className="p-3 font-medium">Статус</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.data.rows.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-border last:border-0 hover:bg-muted/30"
                >
                  <td className="p-3">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.email}
                      {u.phone ? ` · ${u.phone}` : ""}
                    </div>
                  </td>
                  <td className="p-3">
                    <Badge variant="secondary">{u.role}</Badge>
                  </td>
                  <td className="p-3 text-sm">
                    {u.clinic ? (
                      <span className="text-muted-foreground">
                        {u.clinic.nameRu}{" "}
                        <span className="font-mono text-[11px]">
                          /{u.clinic.slug}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Badge
                      variant={u.active ? "default" : "destructive"}
                    >
                      {u.active ? "active" : "inactive"}
                    </Badge>
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setReassign(u)}
                      >
                        Переназначить
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (
                            confirm(
                              u.active ? "Деактивировать?" : "Активировать?",
                            )
                          ) {
                            deactivate.mutate(u);
                          }
                        }}
                      >
                        {u.active ? "Деактивировать" : "Активировать"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.data.rows.length && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-8 text-center text-muted-foreground"
                  >
                    Нет пользователей
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ReassignDialog
        user={reassign}
        clinics={clinics.data ?? []}
        onClose={() => setReassign(null)}
        onSaved={() => {
          setReassign(null);
          qc.invalidateQueries({ queryKey: ["admin", "users"] });
        }}
      />
    </div>
  );
}

function ReassignDialog({
  user,
  clinics,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  clinics: ClinicOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [clinicId, setClinicId] = React.useState<string>("");
  const [role, setRole] = React.useState<Role | "">("");

  React.useEffect(() => {
    if (user) {
      setClinicId(user.clinicId ?? "");
      setRole(user.role);
    }
  }, [user]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!user) return;
      await patchUser(user.id, {
        clinicId: clinicId || null,
        role: (role as Role) || user.role,
      });
    },
    onSuccess: () => {
      toast.success("Обновлено");
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  return (
    <Dialog open={!!user} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Переназначить клинику и роль</DialogTitle>
          <DialogDescription>
            Не-SUPER_ADMIN всегда должен быть привязан к клинике.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Клиника</Label>
            <Select value={clinicId} onValueChange={setClinicId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите клинику" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— (только для SUPER_ADMIN)</SelectItem>
                {clinics.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nameRu}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Роль</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
