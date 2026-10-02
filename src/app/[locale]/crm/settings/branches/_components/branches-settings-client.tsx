"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranchIcon, PlusIcon, Trash2Icon } from "lucide-react";
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

import {
  SettingsApiError,
  settingsFetch,
} from "../../_hooks/use-settings-api";

type BranchUsage = {
  doctors: number;
  cabinets: number;
  upcomingAppointments: number;
};

/** API `reason` → message key under `branches.errors` (audit ST-06). */
const BRANCH_ERROR_KEYS: Record<string, string> = {
  last_active_branch: "lastActive",
  default_branch: "defaultBranch",
  inactive_default: "inactiveDefault",
};

type BranchRow = {
  id: string;
  slug: string;
  nameRu: string;
  nameUz: string;
  address: string | null;
  phone: string | null;
  timezone: string | null;
  isDefault: boolean;
  isActive: boolean;
};

export function BranchesSettingsClient() {
  const t = useTranslations("settings");
  const qc = useQueryClient();

  const [pageLimit, setPageLimit] = React.useState(200);
  const listQuery = useQuery({
    queryKey: ["settings", "branches", pageLimit],
    queryFn: () =>
      settingsFetch<{ rows: BranchRow[]; total?: number }>(
        `/api/crm/branches?limit=${pageLimit}`,
      ),
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  // A branch the admin is switching off while doctors, cabinets or upcoming
  // visits still point at it: the server answered with the counts and waits
  // for a confirmation (audit ST-06).
  const [inUse, setInUse] = React.useState<{
    row: BranchRow;
    usage: BranchUsage;
    via: "patch" | "delete";
  } | null>(null);

  const branchError = (e: Error, row: BranchRow, via: "patch" | "delete") => {
    const reason = e instanceof SettingsApiError ? e.reason : undefined;
    if (reason === "branch_in_use" && e instanceof SettingsApiError) {
      const usage = (e.details as { usage?: BranchUsage } | null)?.usage;
      if (usage) {
        setInUse({ row, usage, via });
        return;
      }
    }
    const key = reason ? BRANCH_ERROR_KEYS[reason] : undefined;
    toast.error(key ? t(`branches.errors.${key}`) : e.message);
    // The card flipped its switch optimistically; put it back.
    qc.invalidateQueries({ queryKey: ["settings", "branches"] });
  };

  const patchMutation = useMutation({
    mutationFn: (payload: {
      row: BranchRow;
      data: Partial<BranchRow> & { confirmInUse?: boolean };
    }) =>
      settingsFetch<BranchRow>(`/api/crm/branches/${payload.row.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload.data),
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["settings", "branches"] }),
    onError: (e: Error, payload) => branchError(e, payload.row, "patch"),
  });

  const deleteMutation = useMutation({
    mutationFn: (payload: { row: BranchRow; confirm?: boolean }) =>
      settingsFetch(
        `/api/crm/branches/${payload.row.id}${payload.confirm ? "?confirm=1" : ""}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      toast.success(t("branches.deactivated"));
      qc.invalidateQueries({ queryKey: ["settings", "branches"] });
    },
    onError: (e: Error, payload) => branchError(e, payload.row, "delete"),
  });

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? rows.length;
  const hasMore = total > rows.length;

  return (
    <PageContainer>
      <SectionHeader
        title={t("branches.title")}
        subtitle={t("branches.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("branches.add")}
          </Button>
        }
      />

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("common.loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <GitBranchIcon className="size-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("branches.empty")}
            </h3>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              {t("branches.emptyHint")}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="mt-1">
            <PlusIcon className="size-4" />
            {t("branches.addFirst")}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((b) => (
              <BranchCard
                key={b.id}
                row={b}
                onPatch={(data, revert) =>
                  patchMutation.mutate({ row: b, data }, { onError: revert })
                }
                onDelete={() => deleteMutation.mutate({ row: b })}
              />
            ))}
          </div>
          {hasMore ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/40 px-3 py-2 text-xs text-muted-foreground">
              <span>{t("common.shown", { shown: rows.length, total })}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPageLimit((n) => Math.min(n + 200, 1000))}
                disabled={pageLimit >= 1000}
              >
                {t("common.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <CreateBranchDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() =>
          qc.invalidateQueries({ queryKey: ["settings", "branches"] })
        }
      />

      <AlertDialog
        open={inUse !== null}
        onOpenChange={(v: boolean) => {
          if (!v) {
            setInUse(null);
            qc.invalidateQueries({ queryKey: ["settings", "branches"] });
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("branches.inUse.title", {
                name: inUse?.row.nameRu || inUse?.row.slug || "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("branches.inUse.description", {
                doctors: inUse?.usage.doctors ?? 0,
                cabinets: inUse?.usage.cabinets ?? 0,
                appointments: inUse?.usage.upcomingAppointments ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!inUse) return;
                if (inUse.via === "delete") {
                  deleteMutation.mutate({ row: inUse.row, confirm: true });
                } else {
                  patchMutation.mutate({
                    row: inUse.row,
                    data: { isActive: false, confirmInUse: true },
                  });
                }
                setInUse(null);
              }}
            >
              {t("branches.inUse.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

function BranchCard({
  row,
  onPatch,
  onDelete,
}: {
  row: BranchRow;
  /** `revert` runs when the server refuses the change. */
  onPatch: (data: Partial<BranchRow>, revert: () => void) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("settings");
  const [local, setLocal] = React.useState(row);
  React.useEffect(() => setLocal(row), [row]);

  // Put back what the server holds when it refuses an edit (audit ST-18).
  // The list refetch in `branchError` does not reach this state: an
  // unchanged row keeps its identity, so the effect above never re-runs.
  const commit = (data: Partial<BranchRow>) => {
    const held = row;
    onPatch(data, () => setLocal(held));
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranchIcon className="size-4 text-primary" />
          <span className="font-semibold">{local.nameRu || local.slug}</span>
          {local.isDefault && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              {t("branches.defaultBadge")}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={t("common.delete")}
          disabled={!local.isActive}
        >
          <Trash2Icon className="size-4 text-destructive" />
        </Button>
      </div>
      <div>
        <Label className="text-xs">{t("branches.fields.slug")}</Label>
        <Input value={local.slug} readOnly disabled />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("branches.fields.nameRu")}</Label>
          <Input
            value={local.nameRu}
            onChange={(e) => setLocal({ ...local, nameRu: e.target.value })}
            onBlur={() =>
              local.nameRu !== row.nameRu && commit({ nameRu: local.nameRu })
            }
          />
        </div>
        <div>
          <Label className="text-xs">{t("branches.fields.nameUz")}</Label>
          <Input
            value={local.nameUz}
            onChange={(e) => setLocal({ ...local, nameUz: e.target.value })}
            onBlur={() =>
              local.nameUz !== row.nameUz && commit({ nameUz: local.nameUz })
            }
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">{t("branches.fields.address")}</Label>
        <Input
          value={local.address ?? ""}
          onChange={(e) => setLocal({ ...local, address: e.target.value })}
          onBlur={() =>
            (local.address ?? null) !== (row.address ?? null) &&
            commit({ address: local.address || null })
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">{t("branches.fields.phone")}</Label>
          <Input
            value={local.phone ?? ""}
            onChange={(e) => setLocal({ ...local, phone: e.target.value })}
            onBlur={() =>
              (local.phone ?? null) !== (row.phone ?? null) &&
              commit({ phone: local.phone || null })
            }
          />
        </div>
        <div>
          <Label className="text-xs">{t("branches.fields.timezone")}</Label>
          <Input
            value={local.timezone ?? ""}
            onChange={(e) => setLocal({ ...local, timezone: e.target.value })}
            onBlur={() =>
              (local.timezone ?? null) !== (row.timezone ?? null) &&
              commit({ timezone: local.timezone || null })
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            checked={local.isDefault}
            onCheckedChange={(v: boolean) => {
              if (!v && row.isDefault) {
                // Cannot just unset default — promote a different branch
                // first. Refuse silently in the UI; the API would also
                // accept this but the clinic might end up without a
                // default until next save.
                toast.message(t("branches.hints.flipDefault"));
                return;
              }
              setLocal({ ...local, isDefault: v });
              commit({ isDefault: v });
            }}
            id={`default-${local.id}`}
          />
          <Label htmlFor={`default-${local.id}`} className="text-xs">
            {t("branches.fields.isDefault")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={local.isActive}
            onCheckedChange={(v: boolean) => {
              setLocal({ ...local, isActive: v });
              commit({ isActive: v });
            }}
            id={`active-${local.id}`}
          />
          <Label htmlFor={`active-${local.id}`} className="text-xs">
            {local.isActive
              ? t("branches.fields.isActive")
              : t("branches.fields.isInactive")}
          </Label>
        </div>
      </div>
    </div>
  );
}

function CreateBranchDialog({
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
    slug: "",
    nameRu: "",
    nameUz: "",
    address: "",
    phone: "",
    timezone: "",
    isDefault: false,
  });
  const mut = useMutation({
    mutationFn: () =>
      settingsFetch("/api/crm/branches", {
        method: "POST",
        body: JSON.stringify({
          slug: form.slug,
          nameRu: form.nameRu,
          nameUz: form.nameUz,
          address: form.address || null,
          phone: form.phone || null,
          timezone: form.timezone || null,
          isDefault: form.isDefault,
        }),
      }),
    onSuccess: () => {
      toast.success(t("branches.created"));
      onCreated();
      setForm({
        slug: "",
        nameRu: "",
        nameUz: "",
        address: "",
        phone: "",
        timezone: "",
        isDefault: false,
      });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      const reason = e instanceof SettingsApiError ? e.reason : undefined;
      if (reason === "slug_taken") {
        toast.error(t("branches.errors.slugTaken"));
        return;
      }
      toast.error(e.message);
    },
  });
  const canSubmit =
    form.slug.length >= 2 &&
    /^[a-z0-9-]+$/.test(form.slug) &&
    form.nameRu.length >= 1 &&
    form.nameUz.length >= 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("branches.add")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>{t("branches.fields.slug")}</Label>
            <Input
              value={form.slug}
              onChange={(e) =>
                setForm({
                  ...form,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                })
              }
              placeholder="hq, downtown, …"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("branches.fields.slugHint")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("branches.fields.nameRu")}</Label>
              <Input
                value={form.nameRu}
                onChange={(e) => setForm({ ...form, nameRu: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("branches.fields.nameUz")}</Label>
              <Input
                value={form.nameUz}
                onChange={(e) => setForm({ ...form, nameUz: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>{t("branches.fields.address")}</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("branches.fields.phone")}</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("branches.fields.timezone")}</Label>
              <Input
                value={form.timezone}
                onChange={(e) =>
                  setForm({ ...form, timezone: e.target.value })
                }
                placeholder="Asia/Tashkent"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.isDefault}
              onCheckedChange={(v: boolean) =>
                setForm({ ...form, isDefault: v })
              }
              id="create-default"
            />
            <Label htmlFor="create-default" className="text-xs">
              {t("branches.fields.isDefault")}
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !canSubmit}
          >
            {mut.isPending ? t("common.saving") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
