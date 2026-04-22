"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpenIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { settingsFetch } from "../../_hooks/use-settings-api";

type CabinetRow = {
  id: string;
  number: string;
  floor: number | null;
  nameRu: string | null;
  nameUz: string | null;
  equipment: string[];
  isActive: boolean;
};

export function CabinetsSettingsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["settings", "cabinets"],
    queryFn: () =>
      settingsFetch<{ rows: CabinetRow[] }>("/api/crm/cabinets?limit=200"),
  });

  const [createOpen, setCreateOpen] = React.useState(false);

  const patchMutation = useMutation({
    mutationFn: (payload: { id: string; data: Partial<CabinetRow> }) =>
      settingsFetch<CabinetRow>(`/api/crm/cabinets/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload.data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["settings", "cabinets"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      settingsFetch(`/api/crm/cabinets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("cabinets.deactivated"));
      qc.invalidateQueries({ queryKey: ["settings", "cabinets"] });
    },
  });

  const rows = listQuery.data?.rows ?? [];

  return (
    <PageContainer>
      <SectionHeader
        title={t("cabinets.title")}
        subtitle={t("cabinets.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("cabinets.add")}
          </Button>
        }
      />

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
          <DoorOpenIcon className="size-5" />
          {t("cabinets.empty")}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => (
            <CabinetCard
              key={c.id}
              row={c}
              onPatch={(data) => patchMutation.mutate({ id: c.id, data })}
              onDelete={() => deleteMutation.mutate(c.id)}
            />
          ))}
        </div>
      )}

      <CreateCabinetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() =>
          qc.invalidateQueries({ queryKey: ["settings", "cabinets"] })
        }
      />
    </PageContainer>
  );
}

function CabinetCard({
  row,
  onPatch,
  onDelete,
}: {
  row: CabinetRow;
  onPatch: (data: Partial<CabinetRow>) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings");
  const [local, setLocal] = React.useState(row);
  React.useEffect(() => setLocal(row), [row]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DoorOpenIcon className="size-4 text-primary" />
          <span className="font-semibold">
            {t("cabinets.number")} {local.number}
          </span>
          {local.floor != null ? (
            <span className="text-xs text-muted-foreground">
              · {t("cabinets.floor")} {local.floor}
            </span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={t("common.delete")}
        >
          <Trash2Icon className="size-4 text-destructive" />
        </Button>
      </div>
      <div>
        <Label className="text-xs">{t("cabinets.cols.nameRu")}</Label>
        <Input
          value={local.nameRu ?? ""}
          onChange={(e) => setLocal({ ...local, nameRu: e.target.value })}
          onBlur={() =>
            local.nameRu !== row.nameRu &&
            onPatch({ nameRu: local.nameRu || null })
          }
        />
      </div>
      <div>
        <Label className="text-xs">{t("cabinets.cols.nameUz")}</Label>
        <Input
          value={local.nameUz ?? ""}
          onChange={(e) => setLocal({ ...local, nameUz: e.target.value })}
          onBlur={() =>
            local.nameUz !== row.nameUz &&
            onPatch({ nameUz: local.nameUz || null })
          }
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Switch
          checked={local.isActive}
          onCheckedChange={(v: boolean) => {
            setLocal({ ...local, isActive: v });
            onPatch({ isActive: v });
          }}
          id={`active-${local.id}`}
        />
        <Label htmlFor={`active-${local.id}`} className="text-xs">
          {local.isActive
            ? t("cabinets.active")
            : t("cabinets.inactive")}
        </Label>
      </div>
    </div>
  );
}

function CreateCabinetDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations("settings");
  const [form, setForm] = React.useState({
    number: "",
    floor: "",
    nameRu: "",
    nameUz: "",
  });
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/cabinets", {
        method: "POST",
        body: JSON.stringify({
          number: form.number,
          floor: form.floor ? Number(form.floor) : null,
          nameRu: form.nameRu || null,
          nameUz: form.nameUz || null,
        }),
      }),
    onSuccess: () => {
      toast.success(t("cabinets.created"));
      onCreated();
      setForm({ number: "", floor: "", nameRu: "", nameUz: "" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cabinets.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("cabinets.number")}</Label>
              <Input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("cabinets.floor")}</Label>
              <Input
                type="number"
                value={form.floor}
                onChange={(e) => setForm({ ...form, floor: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>{t("cabinets.cols.nameRu")}</Label>
            <Input
              value={form.nameRu}
              onChange={(e) => setForm({ ...form, nameRu: e.target.value })}
            />
          </div>
          <div>
            <Label>{t("cabinets.cols.nameUz")}</Label>
            <Input
              value={form.nameUz}
              onChange={(e) => setForm({ ...form, nameUz: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.number}
          >
            {mut.isPending ? t("common.saving") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
