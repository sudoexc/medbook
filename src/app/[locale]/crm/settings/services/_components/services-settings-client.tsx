"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, StethoscopeIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";

import { settingsFetch } from "../../_hooks/use-settings-api";

type ServiceRow = {
  id: string;
  code: string;
  nameRu: string;
  nameUz: string;
  category: string | null;
  durationMin: number;
  priceBase: number;
  isActive: boolean;
};

export function ServicesSettingsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: ["settings", "services"],
    queryFn: () =>
      settingsFetch<{ rows: ServiceRow[]; nextCursor: string | null }>(
        "/api/crm/services?limit=200",
      ),
  });

  const [createOpen, setCreateOpen] = React.useState(false);

  const patchMutation = useMutation({
    mutationFn: (payload: { id: string; data: Partial<ServiceRow> }) =>
      settingsFetch<ServiceRow>(`/api/crm/services/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload.data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings", "services"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      settingsFetch(`/api/crm/services/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("services.deactivated"));
      qc.invalidateQueries({ queryKey: ["settings", "services"] });
    },
  });

  const rows = listQuery.data?.rows ?? [];

  return (
    <PageContainer>
      <SectionHeader
        title={t("services.title")}
        subtitle={t("services.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("services.add")}
          </Button>
        }
      />

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <StethoscopeIcon className="size-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("services.empty")}
            </h3>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              {t("services.emptyHint")}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="mt-1">
            <PlusIcon className="size-4" />
            {t("services.addFirst")}
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("services.cols.code")}</th>
                <th className="px-3 py-2 font-medium">{t("services.cols.name")}</th>
                <th className="px-3 py-2 font-medium">
                  {t("services.cols.category")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("services.cols.duration")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("services.cols.priceBase")}
                </th>
                <th className="px-3 py-2 font-medium">
                  {t("services.cols.active")}
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <ServiceRowEditor
                  key={s.id}
                  row={s}
                  onPatch={(data) =>
                    patchMutation.mutate({ id: s.id, data })
                  }
                  onDelete={() => deleteMutation.mutate(s.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateServiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() =>
          qc.invalidateQueries({ queryKey: ["settings", "services"] })
        }
      />
    </PageContainer>
  );
}

function ServiceRowEditor({
  row,
  onPatch,
  onDelete,
}: {
  row: ServiceRow;
  onPatch: (data: Partial<ServiceRow>) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings");
  const [local, setLocal] = React.useState(row);
  React.useEffect(() => setLocal(row), [row]);

  const commit = (patch: Partial<ServiceRow>) => {
    setLocal({ ...local, ...patch });
    onPatch(patch);
  };

  return (
    <tr className="border-t border-border hover:bg-muted/30">
      <td className="px-3 py-2 font-mono text-xs">{local.code}</td>
      <td className="px-3 py-2">
        <div className="font-medium">{local.nameRu}</div>
        <div className="text-xs text-muted-foreground">{local.nameUz}</div>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          className="h-8 w-32 rounded border border-input bg-transparent px-2 text-sm"
          value={local.category ?? ""}
          onChange={(e) =>
            setLocal({ ...local, category: e.target.value })
          }
          onBlur={() => {
            const next = local.category?.trim() || null;
            if (next !== row.category) commit({ category: next });
          }}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          className="h-8 w-20 rounded border border-input bg-transparent px-2 text-sm"
          value={local.durationMin}
          min={5}
          max={480}
          step={5}
          onChange={(e) =>
            setLocal({ ...local, durationMin: Number(e.target.value) })
          }
          onBlur={() =>
            local.durationMin !== row.durationMin &&
            commit({ durationMin: local.durationMin })
          }
        />
        <span className="ml-1 text-xs text-muted-foreground">
          {t("services.min")}
        </span>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          className="h-8 w-28 rounded border border-input bg-transparent px-2 text-sm"
          value={local.priceBase}
          min={0}
          onChange={(e) =>
            setLocal({ ...local, priceBase: Number(e.target.value) })
          }
          onBlur={() =>
            local.priceBase !== row.priceBase &&
            commit({ priceBase: local.priceBase })
          }
        />
      </td>
      <td className="px-3 py-2">
        <Switch
          checked={local.isActive}
          onCheckedChange={(v: boolean) => commit({ isActive: v })}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={t("common.delete")}
        >
          <Trash2Icon className="size-4 text-destructive" />
        </Button>
      </td>
    </tr>
  );
}

function CreateServiceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  type DoctorOption = {
    id: string;
    nameRu: string;
    nameUz: string;
    isActive: boolean;
  };
  const [form, setForm] = React.useState<{
    code: string;
    nameRu: string;
    nameUz: string;
    durationMin: number;
    priceBase: number;
    category: string;
    doctorIds: string[];
  }>({
    code: "",
    nameRu: "",
    nameUz: "",
    durationMin: 30,
    priceBase: 0,
    category: "",
    doctorIds: [],
  });
  // Phase 11 invariant: a service must have ≥1 doctor at creation time.
  // Load active doctors so the dialog can present a multi-select.
  const doctorsQuery = useQuery<DoctorOption[], Error>({
    queryKey: ["settings", "service-doctor-picker"],
    enabled: open,
    queryFn: async () => {
      const res = await settingsFetch<{ rows: DoctorOption[] }>(
        "/api/crm/doctors?isActive=true&limit=200",
      );
      return res.rows;
    },
    staleTime: 60_000,
  });
  const toggleDoctor = (id: string) => {
    setForm((s) => ({
      ...s,
      doctorIds: s.doctorIds.includes(id)
        ? s.doctorIds.filter((x) => x !== id)
        : [...s.doctorIds, id],
    }));
  };
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/services", {
        method: "POST",
        body: JSON.stringify({
          code: form.code.toUpperCase().replace(/\s+/g, "_"),
          nameRu: form.nameRu,
          nameUz: form.nameUz,
          category: form.category || null,
          durationMin: form.durationMin,
          priceBase: form.priceBase,
          doctorIds: form.doctorIds,
        }),
      }),
    onSuccess: () => {
      toast.success(t("services.created"));
      onCreated();
      setForm({
        code: "",
        nameRu: "",
        nameUz: "",
        durationMin: 30,
        priceBase: 0,
        category: "",
        doctorIds: [],
      });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("services.add")}</DialogTitle>
          <DialogDescription>{t("services.createHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label htmlFor="s-code">{t("services.cols.code")}</Label>
            <Input
              id="s-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="CONSULT_NEURO"
              className="font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-nameRu">{t("services.cols.nameRu")}</Label>
              <Input
                id="s-nameRu"
                value={form.nameRu}
                onChange={(e) =>
                  setForm({ ...form, nameRu: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="s-nameUz">{t("services.cols.nameUz")}</Label>
              <Input
                id="s-nameUz"
                value={form.nameUz}
                onChange={(e) =>
                  setForm({ ...form, nameUz: e.target.value })
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="s-duration">
                {t("services.cols.duration")}
              </Label>
              <Input
                id="s-duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={form.durationMin}
                onChange={(e) =>
                  setForm({
                    ...form,
                    durationMin: Number(e.target.value) || 30,
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="s-price">
                {t("services.cols.priceBase")}
              </Label>
              <Input
                id="s-price"
                type="number"
                min={0}
                value={form.priceBase}
                onChange={(e) =>
                  setForm({ ...form, priceBase: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <Label htmlFor="s-cat">{t("services.cols.category")}</Label>
              <Input
                id="s-cat"
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value })
                }
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <Label>
                {t("services.doctorsRequired")}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <span className="text-xs text-muted-foreground">
                {t("services.doctorsSelected", {
                  count: form.doctorIds.length,
                })}
              </span>
            </div>
            {doctorsQuery.isLoading ? (
              <div className="text-xs text-muted-foreground">
                {t("common.loading")}
              </div>
            ) : (doctorsQuery.data ?? []).length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                {t("services.doctorsEmpty")}
              </div>
            ) : (
              <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
                {(doctorsQuery.data ?? []).map((d) => {
                  const checked = form.doctorIds.includes(d.id);
                  const id = `svc-doc-${d.id}`;
                  const name = locale === "uz" ? d.nameUz : d.nameRu;
                  return (
                    <label
                      key={d.id}
                      htmlFor={id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted/40"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => toggleDoctor(d.id)}
                      />
                      <span className="truncate">{name}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {form.doctorIds.length === 0 ? (
              <p className="mt-1 text-xs text-destructive">
                {t("services.doctorsRequiredHint")}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={
              mut.isPending ||
              !form.code ||
              !form.nameRu ||
              !form.nameUz ||
              form.doctorIds.length === 0
            }
          >
            {mut.isPending ? t("common.saving") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
