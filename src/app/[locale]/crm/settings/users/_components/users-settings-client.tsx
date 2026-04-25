"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CopyIcon,
  KeyRoundIcon,
  Pencil as PencilIcon,
  PlusIcon,
  Trash2Icon,
  UserCogIcon,
} from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

import { settingsFetch } from "../../_hooks/use-settings-api";

type Role =
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  phone: string | null;
  active: boolean;
  createdAt: string;
};

const ROLES: Role[] = [
  "ADMIN",
  "DOCTOR",
  "RECEPTIONIST",
  "NURSE",
  "CALL_OPERATOR",
];

export function UsersSettingsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const [q, setQ] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<Role | "">("");

  const listQuery = useQuery({
    queryKey: ["settings", "users", q, roleFilter],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (q) sp.set("q", q);
      if (roleFilter) sp.set("role", roleFilter);
      sp.set("limit", "200");
      return settingsFetch<{ rows: UserRow[]; nextCursor: string | null }>(
        `/api/crm/users?${sp.toString()}`,
      );
    },
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editRow, setEditRow] = React.useState<UserRow | null>(null);
  const [deleteRow, setDeleteRow] = React.useState<UserRow | null>(null);
  const [resetRow, setResetRow] = React.useState<UserRow | null>(null);

  const rows = listQuery.data?.rows ?? [];

  return (
    <PageContainer>
      <SectionHeader
        title={t("users.title")}
        subtitle={t("users.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("users.addUser")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("users.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <select
          className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          value={roleFilter}
          onChange={(e) => setRoleFilter((e.target.value as Role) || "")}
        >
          <option value="">{t("users.allRoles")}</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`users.roles.${r}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("users.cols.name")}</th>
              <th className="px-3 py-2 font-medium">{t("users.cols.email")}</th>
              <th className="px-3 py-2 font-medium">{t("users.cols.role")}</th>
              <th className="px-3 py-2 font-medium">{t("users.cols.phone")}</th>
              <th className="px-3 py-2 font-medium">{t("users.cols.status")}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  {t("users.empty")}
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-border hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-medium">{u.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{t(`users.roles.${u.role}`)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {u.phone ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {u.active ? (
                      <span className="inline-flex items-center gap-1 text-xs text-success">
                        <span className="size-1.5 rounded-full bg-success" />
                        {t("users.status.active")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-muted-foreground" />
                        {t("users.status.inactive")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditRow(u)}
                        aria-label={t("common.edit")}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setResetRow(u)}
                        aria-label={t("users.resetPassword")}
                      >
                        <KeyRoundIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteRow(u)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["settings", "users"] });
        }}
      />

      {editRow ? (
        <EditUserDialog
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["settings", "users"] });
            setEditRow(null);
          }}
        />
      ) : null}

      {deleteRow ? (
        <DeleteUserDialog
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["settings", "users"] });
            setDeleteRow(null);
          }}
        />
      ) : null}

      {resetRow ? (
        <ResetPasswordDialog
          row={resetRow}
          onClose={() => setResetRow(null)}
        />
      ) : null}
    </PageContainer>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations("settings");
  const [form, setForm] = React.useState<{
    email: string;
    name: string;
    role: Role;
    phone: string;
    password: string;
  }>({
    email: "",
    name: "",
    role: "RECEPTIONIST",
    phone: "",
    password: "",
  });
  const createMutation = useMutation({
    mutationFn: () =>
      settingsFetch<UserRow>("/api/crm/users", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          role: form.role,
          phone: form.phone || null,
          password: form.password,
        }),
      }),
    onSuccess: () => {
      toast.success(t("users.created"));
      onCreated();
      setForm({ email: "", name: "", role: "RECEPTIONIST", phone: "", password: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCogIcon className="size-4 text-primary" />
            {t("users.addUser")}
          </DialogTitle>
          <DialogDescription>{t("users.createHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="u-name">{t("users.cols.name")}</Label>
            <Input
              id="u-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="u-email">{t("users.cols.email")}</Label>
            <Input
              id="u-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="u-role">{t("users.cols.role")}</Label>
              <select
                id="u-role"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as Role })
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`users.roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="u-phone">{t("users.cols.phone")}</Label>
              <Input
                id="u-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="u-pw">{t("users.cols.password")}</Label>
            <Input
              id="u-pw"
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm({ ...form, password: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("users.passwordHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={
              createMutation.isPending ||
              !form.email ||
              !form.name ||
              form.password.length < 8
            }
          >
            {createMutation.isPending
              ? t("common.saving")
              : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({
  row,
  onClose,
  onSaved,
}: {
  row: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settings");
  const [form, setForm] = React.useState<{
    name: string;
    role: Role;
    phone: string;
    active: boolean;
  }>({
    name: row.name,
    role: row.role,
    phone: row.phone ?? "",
    active: row.active,
  });
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch<UserRow>(`/api/crm/users/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          phone: form.phone || null,
          active: form.active,
        }),
      }),
    onSuccess: () => {
      toast.success(t("common.saved"));
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(v: boolean) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("users.editUser")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>{t("users.cols.name")}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("users.cols.role")}</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={form.role}
                onChange={(e) =>
                  setForm({ ...form, role: e.target.value as Role })
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`users.roles.${r}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("users.cols.phone")}</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.active}
              onCheckedChange={(v: boolean) => setForm({ ...form, active: v })}
              id="edit-active"
            />
            <Label htmlFor="edit-active">
              {form.active
                ? t("users.status.active")
                : t("users.status.inactive")}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.name}
          >
            {mut.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: UserRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("settings");
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch<{ id: string }>(`/api/crm/users/${row.id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      toast.success(t("users.deactivated"));
      onDeleted();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <AlertDialog open onOpenChange={(v: boolean) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("users.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("users.deleteDescription", { name: row.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => mut.mutate()}>
            {t("users.deactivate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResetPasswordDialog({
  row,
  onClose,
}: {
  row: UserRow;
  onClose: () => void;
}) {
  const t = useTranslations("settings");
  const [password, setPassword] = React.useState("");
  const [generated, setGenerated] = React.useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (payload: { newPassword?: string }) =>
      settingsFetch<{ generatedPassword: string | null }>(
        `/api/crm/users/${row.id}/reset-password`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      ),
    onSuccess: (data) => {
      if (data.generatedPassword) {
        setGenerated(data.generatedPassword);
        toast.success(t("users.passwordGenerated"));
      } else {
        toast.success(t("users.passwordSet"));
        onClose();
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v: boolean) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" />
            {t("users.resetPassword")}
          </DialogTitle>
          <DialogDescription>
            {t("users.resetDescription", { name: row.name })}
          </DialogDescription>
        </DialogHeader>
        {generated ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              {t("users.passwordOnceWarning")}
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">
              <span className="flex-1 break-all">{generated}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(generated);
                  toast.success(t("users.copied"));
                }}
                aria-label={t("users.copy")}
              >
                <CopyIcon className="size-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="r-pw">{t("users.newPassword")}</Label>
              <Input
                id="r-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("users.resetBlankHint")}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {generated ? t("common.close") : t("common.cancel")}
          </Button>
          {generated ? null : (
            <Button
              onClick={() =>
                mut.mutate(
                  password.length >= 8 ? { newPassword: password } : {},
                )
              }
              disabled={mut.isPending}
            >
              {mut.isPending ? t("common.saving") : t("users.resetConfirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
