"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCardIcon,
  MessageSquareIcon,
  PhoneIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
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

type Family = "SMS" | "TG" | "PAYMENT" | "TELEPHONY";

interface IntegrationRow {
  id: string;
  clinicId: string;
  kind: string;
  label: string | null;
  hasSecret: boolean;
  secretMasked: string | null;
  config: Record<string, unknown> | null;
  active: boolean;
}

interface IntegrationsResp {
  clinic: { id: string; slug: string; nameRu: string };
  rows: IntegrationRow[];
  families: Record<Family, string[]>;
}

const FAMILY_META: Record<Family, {
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = {
  SMS: {
    title: "SMS",
    description: "Eskiz, Playmobile и прочие провайдеры SMS",
    Icon: MessageSquareIcon,
  },
  TG: {
    title: "Telegram",
    description: "Бот клиники: токен, webhook-secret",
    Icon: SendIcon,
  },
  PAYMENT: {
    title: "Платежи",
    description: "Payme, Click, Uzum — мерчант-ключи",
    Icon: CreditCardIcon,
  },
  TELEPHONY: {
    title: "Телефония",
    description: "SIP-шлюз (label=sip, kind=OTHER до расширения enum)",
    Icon: PhoneIcon,
  },
};

async function fetchIntegrations(
  clinicId: string,
): Promise<IntegrationsResp> {
  const r = await fetch(
    `/api/platform/clinics/${clinicId}/integrations`,
    { cache: "no-store" },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as IntegrationsResp;
}

async function upsertIntegration(
  clinicId: string,
  body: {
    family: Family;
    kind: string;
    label?: string | null;
    secret?: string;
    config?: Record<string, unknown> | null;
    active?: boolean;
  },
): Promise<void> {
  const r = await fetch(`/api/platform/clinics/${clinicId}/integrations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const parsed = (await r.json().catch(() => null)) as { reason?: string } | null;
    throw new Error(parsed?.reason ?? `HTTP ${r.status}`);
  }
}

async function patchIntegration(
  id: string,
  patch: {
    label?: string | null;
    secret?: string;
    config?: Record<string, unknown> | null;
    active?: boolean;
  },
): Promise<void> {
  const r = await fetch(`/api/platform/integrations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

async function deleteIntegration(id: string): Promise<void> {
  const r = await fetch(`/api/platform/integrations/${id}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export function IntegrationsPageClient({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "integrations", clinicId],
    queryFn: () => fetchIntegrations(clinicId),
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/clinics"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Все клиники
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-foreground">
            Интеграции: {data?.clinic.nameRu ?? "…"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Секреты зашифрованы AES-256-GCM. В UI видны только последние 4 символа.
          </p>
        </div>
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

      {data && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {(Object.keys(FAMILY_META) as Family[]).map((fam) => {
            const allowedKinds = data.families[fam] ?? [];
            const rows = data.rows.filter((r) => allowedKinds.includes(r.kind));
            return (
              <FamilyCard
                key={fam}
                family={fam}
                clinicId={clinicId}
                allowedKinds={allowedKinds}
                rows={rows}
                onChanged={() =>
                  qc.invalidateQueries({
                    queryKey: ["admin", "integrations", clinicId],
                  })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function FamilyCard({
  family,
  clinicId,
  allowedKinds,
  rows,
  onChanged,
}: {
  family: Family;
  clinicId: string;
  allowedKinds: string[];
  rows: IntegrationRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = React.useState<IntegrationRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const meta = FAMILY_META[family];

  const toggleActive = useMutation({
    mutationFn: (r: IntegrationRow) =>
      patchIntegration(r.id, { active: !r.active }),
    onSuccess: onChanged,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => {
      toast.success("Удалено");
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <meta.Icon className="size-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {meta.title}
            </h2>
            <p className="text-xs text-muted-foreground">{meta.description}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <PlusIcon />
          Добавить
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {rows.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Нет подключений
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between rounded-md border border-border/60 bg-background/50 p-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{r.kind}</Badge>
                {r.label && (
                  <span className="text-xs text-muted-foreground">
                    {r.label}
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                secret: {r.hasSecret ? r.secretMasked : "—"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={r.active}
                onCheckedChange={() => toggleActive.mutate(r)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(r)}
              >
                Править
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  if (confirm("Удалить подключение?")) del.mutate(r.id);
                }}
              >
                <Trash2Icon className="text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <IntegrationEditor
        open={creating}
        onOpenChange={setCreating}
        clinicId={clinicId}
        family={family}
        allowedKinds={allowedKinds}
        existing={null}
        onSaved={() => {
          setCreating(false);
          onChanged();
        }}
      />
      <IntegrationEditor
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        clinicId={clinicId}
        family={family}
        allowedKinds={allowedKinds}
        existing={editing}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </div>
  );
}

function IntegrationEditor({
  open,
  onOpenChange,
  clinicId,
  family,
  allowedKinds,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clinicId: string;
  family: Family;
  allowedKinds: string[];
  existing: IntegrationRow | null;
  onSaved: () => void;
}) {
  const [kind, setKind] = React.useState(existing?.kind ?? allowedKinds[0] ?? "");
  const [label, setLabel] = React.useState(existing?.label ?? "");
  const [replaceSecret, setReplaceSecret] = React.useState(!existing);
  const [secret, setSecret] = React.useState("");
  const [configText, setConfigText] = React.useState(
    existing?.config ? JSON.stringify(existing.config, null, 2) : "{}",
  );
  const [active, setActive] = React.useState(existing?.active ?? true);

  React.useEffect(() => {
    if (open) {
      setKind(existing?.kind ?? allowedKinds[0] ?? "");
      setLabel(existing?.label ?? "");
      setReplaceSecret(!existing);
      setSecret("");
      setConfigText(
        existing?.config ? JSON.stringify(existing.config, null, 2) : "{}",
      );
      setActive(existing?.active ?? true);
    }
  }, [open, existing, allowedKinds]);

  const mut = useMutation({
    mutationFn: async () => {
      let parsedConfig: Record<string, unknown> | null = null;
      try {
        parsedConfig = configText.trim() ? JSON.parse(configText) : null;
      } catch {
        throw new Error("Invalid JSON в config");
      }
      if (existing) {
        await patchIntegration(existing.id, {
          label: label.trim() || null,
          ...(replaceSecret && secret ? { secret } : {}),
          config: parsedConfig,
          active,
        });
      } else {
        await upsertIntegration(clinicId, {
          family,
          kind,
          label: label.trim() || null,
          ...(secret ? { secret } : {}),
          config: parsedConfig,
          active,
        });
      }
    },
    onSuccess: () => {
      toast.success("Сохранено");
      onSaved();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Редактировать подключение" : "Новое подключение"}
          </DialogTitle>
          <DialogDescription>
            Секрет записывается зашифрованным. После сохранения увидите только маску.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Тип</Label>
            <Select value={kind} onValueChange={setKind} disabled={!!existing}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedKinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Метка (label)</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="eskiz / payme / sip"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Секрет</Label>
            {existing && !replaceSecret ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
                  {existing.secretMasked ?? "(не задан)"}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReplaceSecret(true)}
                >
                  Заменить
                </Button>
              </div>
            ) : (
              <Input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="plain-text; шифруется при сохранении"
              />
            )}
          </div>
          <div className="grid gap-1.5">
            <Label>Config (JSON)</Label>
            <textarea
              className="min-h-[120px] rounded-md border border-border bg-background p-2 font-mono text-xs"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={active} onCheckedChange={setActive} />
            <Label>Активно</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

// `cn` is imported for consistency with other admin pages; exported buttonVariants
// allows upgrading anchor-styled rows without touching this file.
void cn;
void buttonVariants;
