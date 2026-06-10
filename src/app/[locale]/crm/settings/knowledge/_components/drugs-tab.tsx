"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";
import { DRUG_CATEGORIES } from "@/server/schemas/knowledge";

import {
  SettingsApiError,
  settingsFetch,
} from "../../_hooks/use-settings-api";
import {
  EmptyState,
  Field,
  RowBadges,
  listToText,
  textToList,
  useOverlayMutation,
} from "./shared";

type DrugForm = { form: string; strengths?: string[] };
type DrugDosing = { adult?: string; pediatric?: string; renal?: string };

type DrugRow = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: string;
  forms: unknown;
  indications: string[];
  contraindications: string[];
  sideEffects: string[];
  defaultDosing: unknown;
  rxOnly: boolean;
  active: boolean;
  clinicId: string | null;
  clinicOverridden: boolean;
  hiddenByClinic: boolean;
};

const QUERY_KEY = ["settings", "knowledge", "drugs"] as const;

function formsToText(forms: unknown): string {
  if (!Array.isArray(forms)) return "";
  return (forms as DrugForm[])
    .filter((f) => f && typeof f.form === "string")
    .map((f) =>
      f.strengths && f.strengths.length > 0
        ? `${f.form}: ${f.strengths.join(", ")}`
        : f.form,
    )
    .join("\n");
}

function parseForms(s: string): DrugForm[] {
  return textToList(s)
    .map((line) => {
      const idx = line.indexOf(":");
      const form = (idx === -1 ? line : line.slice(0, idx)).trim();
      const strengths =
        idx === -1
          ? []
          : line
              .slice(idx + 1)
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean);
      return { form, strengths };
    })
    .filter((f) => f.form.length > 0);
}

function dosingField(d: unknown, key: keyof DrugDosing): string {
  if (!d || typeof d !== "object" || Array.isArray(d)) return "";
  const v = (d as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** Enum → i18n suffix under doctor.receptionDialogs.catalog.categories.* */
function categoryKey(cat: string): string {
  return cat.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function DrugsTab() {
  const t = useTranslations("settings.knowledge");
  const tCat = useTranslations("doctor.receptionDialogs.catalog.categories");
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const q = React.useDeferredValue(search.trim());
  const listQuery = useQuery({
    queryKey: [...QUERY_KEY, q],
    queryFn: () =>
      settingsFetch<{ rows: DrugRow[]; total: number }>(
        `/api/crm/catalogs/drugs?limit=200&includeHidden=1${
          q ? `&q=${encodeURIComponent(q)}` : ""
        }`,
      ),
  });

  const overlayMutation = useOverlayMutation(QUERY_KEY);
  const [dialog, setDialog] = React.useState<
    | { mode: "create" }
    | { mode: "edit"; row: DrugRow }
    | { mode: "override"; row: DrugRow }
    | null
  >(null);
  const [deleteRow, setDeleteRow] = React.useState<DrugRow | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      settingsFetch(`/api/crm/knowledge/drugs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("toasts.deactivated"));
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQuery.data?.rows ?? [];

  const categoryLabel = (cat: string) => {
    const key = categoryKey(cat);
    return tCat.has(key) ? tCat(key) : cat;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-xs"
        />
        <div className="flex-1" />
        <Button onClick={() => setDialog({ mode: "create" })}>
          <PlusIcon className="size-4" />
          {t("drugs.add")}
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <EmptyState text={t("drugs.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("drugs.columns.name")}</TableHead>
                <TableHead>{t("drugs.columns.inn")}</TableHead>
                <TableHead>{t("drugs.columns.category")}</TableHead>
                <TableHead>{t("columns.origin")}</TableHead>
                <TableHead className="w-32 text-right">
                  {t("columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={row.hiddenByClinic ? "opacity-55" : undefined}
                >
                  <TableCell>
                    <div className="font-medium">{row.nameRu}</div>
                    {row.nameUz ? (
                      <div className="text-xs text-muted-foreground">
                        {row.nameUz}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.inn}
                  </TableCell>
                  <TableCell className="text-xs">
                    {categoryLabel(row.category)}
                  </TableCell>
                  <TableCell>
                    <RowBadges row={row} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("actions.edit")}
                        onClick={() =>
                          setDialog(
                            row.clinicId !== null
                              ? { mode: "edit", row }
                              : { mode: "override", row },
                          )
                        }
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      {row.clinicId === null ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            row.hiddenByClinic
                              ? t("actions.show")
                              : t("actions.hide")
                          }
                          disabled={overlayMutation.isPending}
                          onClick={() =>
                            overlayMutation.mutate(
                              {
                                entityType: "DRUG",
                                entityCode: row.id,
                                hideGlobal: !row.hiddenByClinic,
                              },
                              {
                                onSuccess: () =>
                                  toast.success(
                                    row.hiddenByClinic
                                      ? t("toasts.shown")
                                      : t("toasts.hidden"),
                                  ),
                              },
                            )
                          }
                        >
                          {row.hiddenByClinic ? (
                            <EyeIcon className="size-4" />
                          ) : (
                            <EyeOffIcon className="size-4" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("actions.delete")}
                          onClick={() => setDeleteRow(row)}
                        >
                          <Trash2Icon className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog ? (
        <DrugDialog
          state={dialog}
          onClose={() => setDialog(null)}
          categoryLabel={categoryLabel}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteRow !== null}
        onOpenChange={(v) => !v && setDeleteRow(null)}
        title={t("drugs.deleteTitle")}
        description={deleteRow ? deleteRow.nameRu : undefined}
        confirmLabel={t("actions.delete")}
        cancelLabel={t("actions.cancel")}
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteRow) deleteMutation.mutate(deleteRow.id);
        }}
      />
    </div>
  );
}

function DrugDialog({
  state,
  onClose,
  categoryLabel,
}: {
  state:
    | { mode: "create" }
    | { mode: "edit"; row: DrugRow }
    | { mode: "override"; row: DrugRow };
  onClose: () => void;
  categoryLabel: (cat: string) => string;
}) {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();
  const row = state.mode === "create" ? null : state.row;
  const isOverride = state.mode === "override";

  const [form, setForm] = React.useState(() => ({
    inn: row?.inn ?? "",
    nameRu: row?.nameRu ?? "",
    nameUz: row?.nameUz ?? "",
    category: row?.category ?? "OTHER",
    atcCode: row?.atcCode ?? "",
    forms: formsToText(row?.forms),
    indications: listToText(row?.indications),
    contraindications: listToText(row?.contraindications),
    sideEffects: listToText(row?.sideEffects),
    dosingAdult: dosingField(row?.defaultDosing, "adult"),
    dosingPediatric: dosingField(row?.defaultDosing, "pediatric"),
    dosingRenal: dosingField(row?.defaultDosing, "renal"),
    rxOnly: row?.rxOnly ?? true,
  }));

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const buildDosing = (): DrugDosing | null => {
    const d: DrugDosing = {};
    if (form.dosingAdult.trim()) d.adult = form.dosingAdult.trim();
    if (form.dosingPediatric.trim()) d.pediatric = form.dosingPediatric.trim();
    if (form.dosingRenal.trim()) d.renal = form.dosingRenal.trim();
    return Object.keys(d).length > 0 ? d : null;
  };

  const overlayMutation = useOverlayMutation(QUERY_KEY, onClose);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        inn: form.inn.trim(),
        nameRu: form.nameRu.trim(),
        nameUz: form.nameUz.trim() || null,
        category: form.category,
        atcCode: form.atcCode.trim() || null,
        forms: parseForms(form.forms),
        indications: textToList(form.indications),
        contraindications: textToList(form.contraindications),
        sideEffects: textToList(form.sideEffects),
        defaultDosing: buildDosing(),
        rxOnly: form.rxOnly,
      };
      return state.mode === "create"
        ? settingsFetch("/api/crm/knowledge/drugs", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : settingsFetch(`/api/crm/knowledge/drugs/${state.row.id}`, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
    },
    onSuccess: () => {
      toast.success(
        state.mode === "create" ? t("toasts.created") : t("toasts.saved"),
      );
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (e: Error) => {
      const reason = e instanceof SettingsApiError ? e.reason : undefined;
      toast.error(
        reason === "inn_taken" ? t("errors.innTaken") : e.message,
      );
    },
  });

  const saveOverride = () =>
    overlayMutation.mutate(
      {
        entityType: "DRUG",
        entityCode: state.mode === "override" ? state.row.id : "",
        overrides: {
          nameRu: form.nameRu.trim(),
          nameUz: form.nameUz.trim() || null,
          defaultDosing: buildDosing(),
          contraindications: textToList(form.contraindications),
          sideEffects: textToList(form.sideEffects),
          rxOnly: form.rxOnly,
        },
      },
      { onSuccess: () => toast.success(t("toasts.overrideSaved")) },
    );

  const resetOverride = () =>
    overlayMutation.mutate(
      {
        entityType: "DRUG",
        entityCode: state.mode === "override" ? state.row.id : "",
        overrides: null,
      },
      { onSuccess: () => toast.success(t("toasts.overrideReset")) },
    );

  const pending = saveMutation.isPending || overlayMutation.isPending;
  const canSubmit = isOverride
    ? form.nameRu.trim().length > 0
    : form.inn.trim().length >= 2 && form.nameRu.trim().length > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "create"
              ? t("drugs.add")
              : state.mode === "edit"
                ? t("drugs.editTitle")
                : t("drugs.overrideTitle")}
          </DialogTitle>
        </DialogHeader>

        {isOverride ? (
          <p className="rounded-md bg-info/10 px-3 py-2 text-xs text-foreground">
            {t("overrideNote")}
          </p>
        ) : null}

        <div className="space-y-3 py-2">
          {isOverride && row ? (
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                {t("drugs.fields.inn")}: <strong>{row.inn}</strong>
              </div>
              <div>
                {t("drugs.fields.category")}:{" "}
                <strong>{categoryLabel(row.category)}</strong>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("drugs.fields.inn")}>
                  <Input
                    value={form.inn}
                    onChange={(e) => set("inn", e.target.value)}
                  />
                </Field>
                <Field label={t("drugs.fields.atcCode")}>
                  <Input
                    value={form.atcCode}
                    onChange={(e) => set("atcCode", e.target.value)}
                    placeholder="C07AB07"
                  />
                </Field>
              </div>
              <Field label={t("drugs.fields.category")}>
                <Select
                  value={form.category}
                  onValueChange={(v) => set("category", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DRUG_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {categoryLabel(cat)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("drugs.fields.nameRu")}>
              <Input
                value={form.nameRu}
                onChange={(e) => set("nameRu", e.target.value)}
              />
            </Field>
            <Field label={t("drugs.fields.nameUz")}>
              <Input
                value={form.nameUz}
                onChange={(e) => set("nameUz", e.target.value)}
              />
            </Field>
          </div>

          {!isOverride ? (
            <>
              <Field
                label={t("drugs.fields.forms")}
                hint={t("drugs.fields.formsHint")}
              >
                <Textarea
                  rows={3}
                  value={form.forms}
                  onChange={(e) => set("forms", e.target.value)}
                  placeholder={"TAB: 5 мг, 10 мг\nSYRUP: 100 мл"}
                />
              </Field>
              <Field
                label={t("drugs.fields.indications")}
                hint={t("hints.icdPerLine")}
              >
                <Textarea
                  rows={3}
                  value={form.indications}
                  onChange={(e) => set("indications", e.target.value)}
                  placeholder={"G43\nI10"}
                />
              </Field>
            </>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("drugs.fields.contraindications")}
              hint={t("hints.linePerItem")}
            >
              <Textarea
                rows={3}
                value={form.contraindications}
                onChange={(e) => set("contraindications", e.target.value)}
              />
            </Field>
            <Field
              label={t("drugs.fields.sideEffects")}
              hint={t("hints.linePerItem")}
            >
              <Textarea
                rows={3}
                value={form.sideEffects}
                onChange={(e) => set("sideEffects", e.target.value)}
              />
            </Field>
          </div>

          <Field label={t("drugs.fields.dosingAdult")}>
            <Textarea
              rows={2}
              value={form.dosingAdult}
              onChange={(e) => set("dosingAdult", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("drugs.fields.dosingPediatric")}>
              <Textarea
                rows={2}
                value={form.dosingPediatric}
                onChange={(e) => set("dosingPediatric", e.target.value)}
              />
            </Field>
            <Field label={t("drugs.fields.dosingRenal")}>
              <Textarea
                rows={2}
                value={form.dosingRenal}
                onChange={(e) => set("dosingRenal", e.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="drug-rx-only"
              checked={form.rxOnly}
              onCheckedChange={(v: boolean) => set("rxOnly", v)}
            />
            <span className="text-xs">{t("drugs.fields.rxOnly")}</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          {isOverride && row?.clinicOverridden ? (
            <Button
              variant="outline"
              onClick={resetOverride}
              disabled={pending}
              className="mr-auto"
            >
              <Undo2Icon className="size-4" />
              {t("actions.resetOverride")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => (isOverride ? saveOverride() : saveMutation.mutate())}
            disabled={pending || !canSubmit}
          >
            {pending ? t("actions.saving") : t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
