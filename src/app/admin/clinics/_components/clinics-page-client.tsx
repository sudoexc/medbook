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
} from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
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
  _count?: { users: number; patients: number; appointments: number };
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

async function createClinic(input: {
  slug: string;
  nameRu: string;
  nameUz: string;
  timezone: string;
  currency: "UZS";
  ownerName: string;
  ownerEmail: string;
  active: boolean;
}): Promise<CreatedClinicResponse> {
  const r = await fetch("/api/platform/clinics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(body?.reason ?? `HTTP ${r.status}`);
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

async function resetOwnerPassword(
  clinicId: string,
): Promise<{ ownerLogin: string; ownerTempPassword: string }> {
  const r = await fetch(
    `/api/platform/clinics/${clinicId}/reset-owner-password`,
    { method: "POST" },
  );
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(body?.reason ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as { ownerLogin: string; ownerTempPassword: string };
}

async function impersonateClinic(clinicId: string): Promise<void> {
  // POST sets the signed `admin_clinic_override` cookie; the JWT callback
  // picks it up on the next request, so we hard-navigate to /ru/crm so the
  // CRM layout renders against the new claim. Hard-nav (not router.push)
  // because router.refresh() doesn't always flush the layout cache cleanly
  // when the underlying session token changes.
  const r = await fetch("/api/platform/session/switch-clinic", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clinicId }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  window.location.href = "/ru/crm";
}

export function ClinicsPageClient() {
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

  const toggleActive = useMutation({
    mutationFn: (row: ClinicRow) => patchClinic(row.id, { active: !row.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "clinics"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const enterClinic = useMutation({
    mutationFn: (clinicId: string) => impersonateClinic(clinicId),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const resetPwd = useMutation({
    mutationFn: (clinicId: string) => resetOwnerPassword(clinicId),
    onSuccess: (res) =>
      setCredsModal({
        title: "Пароль сброшен",
        login: res.ownerLogin,
        password: res.ownerTempPassword,
      }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
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
                  <td className="p-3">
                    <Switch
                      checked={c.active}
                      onCheckedChange={() => toggleActive.mutate(c)}
                    />
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => enterClinic.mutate(c.id)}
                        disabled={
                          !c.active ||
                          (enterClinic.isPending &&
                            enterClinic.variables === c.id)
                        }
                      >
                        <LogInIcon />
                        Войти
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Сбросить пароль владельца клиники «${c.nameRu}»? Текущий пароль перестанет работать.`,
                            )
                          ) {
                            resetPwd.mutate(c.id);
                          }
                        }}
                        disabled={
                          resetPwd.isPending && resetPwd.variables === c.id
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
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
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

      <CredentialsModal
        creds={credsModal}
        onClose={() => setCredsModal(null)}
      />
    </div>
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

  const reset = () => {
    setSlug("");
    setNameRu("");
    setNameUz("");
    setOwnerName("");
    setOwnerEmail("");
    setEmailError(null);
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
              !ownerEmail.includes("@")
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
      // Force-close only via the explicit button so the operator does not
      // dismiss this by tapping outside before saving the password.
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
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
