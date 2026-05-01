"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, PencilIcon, CreditCardIcon } from "lucide-react";

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
  currency: "UZS" | "USD";
  secondaryCurrency?: "UZS" | "USD" | null;
  active: boolean;
}): Promise<void> {
  const r = await fetch("/api/platform/clinics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(body?.reason ?? `HTTP ${r.status}`);
  }
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

export function ClinicsPageClient() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "clinics"],
    queryFn: fetchClinics,
  });
  const [creating, setCreating] = React.useState(false);

  const toggleActive = useMutation({
    mutationFn: (row: ClinicRow) => patchClinic(row.id, { active: !row.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "clinics"] }),
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
                    <Badge variant="secondary">
                      {c.currency}
                      {c.secondaryCurrency ? ` + ${c.secondaryCurrency}` : ""}
                    </Badge>
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
        onCreated={() =>
          qc.invalidateQueries({ queryKey: ["admin", "clinics"] })
        }
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
  onCreated: () => void;
}) {
  const [slug, setSlug] = React.useState("");
  const [nameRu, setNameRu] = React.useState("");
  const [nameUz, setNameUz] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Tashkent");
  const [currency, setCurrency] = React.useState<"UZS" | "USD">("UZS");
  const [secondary, setSecondary] = React.useState<"NONE" | "UZS" | "USD">(
    "NONE",
  );

  const mut = useMutation({
    mutationFn: () =>
      createClinic({
        slug: slug.trim(),
        nameRu: nameRu.trim(),
        nameUz: nameUz.trim(),
        timezone,
        currency,
        secondaryCurrency: secondary === "NONE" ? null : secondary,
        active: true,
      }),
    onSuccess: () => {
      toast.success("Клиника создана");
      onCreated();
      onOpenChange(false);
      setSlug("");
      setNameRu("");
      setNameUz("");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая клиника</DialogTitle>
          <DialogDescription>
            Слаг нельзя изменить после создания. Разрешены: a-z, 0-9, дефис.
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
          <div className="grid grid-cols-3 gap-3">
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
              <Select value={currency} onValueChange={(v) => setCurrency(v as "UZS" | "USD")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UZS">UZS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Вторая валюта</Label>
              <Select
                value={secondary}
                onValueChange={(v) => setSecondary(v as typeof secondary)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">—</SelectItem>
                  <SelectItem value="UZS">UZS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
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
              !nameUz.trim()
            }
          >
            {mut.isPending ? "Создание…" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
