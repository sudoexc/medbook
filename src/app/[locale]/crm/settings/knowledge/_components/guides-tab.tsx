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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";

import { settingsFetch } from "../../_hooks/use-settings-api";
import {
  EmptyState,
  Field,
  RowBadges,
  listToText,
  textToList,
  useOverlayMutation,
} from "./shared";

type GuideRow = {
  id: string;
  code: string;
  clinicId: string | null;
  matchPrefix: string;
  titleRu: string;
  titleUz: string | null;
  whatToDoRu: string | null;
  whatToDoUz: string | null;
  careRu: string | null;
  careUz: string | null;
  lifestyleRu: string | null;
  lifestyleUz: string | null;
  redFlagsRu: string | null;
  redFlagsUz: string | null;
  adviceChips: string[];
  defaultFollowUpDays: number | null;
  sortOrder: number;
  active: boolean;
  clinicOverridden: boolean;
  hiddenByClinic: boolean;
};

const QUERY_KEY = ["settings", "knowledge", "guides"] as const;

const BLOCK_PAIRS = [
  ["whatToDoRu", "whatToDoUz"],
  ["careRu", "careUz"],
  ["lifestyleRu", "lifestyleUz"],
  ["redFlagsRu", "redFlagsUz"],
] as const;

type BlockKey = (typeof BLOCK_PAIRS)[number][number];

export function GuidesTab() {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const q = React.useDeferredValue(search.trim().toLowerCase());
  const listQuery = useQuery({
    queryKey: [...QUERY_KEY],
    queryFn: () =>
      settingsFetch<{ rows: GuideRow[]; total: number }>(
        "/api/crm/guides?includeHidden=1",
      ),
  });

  const overlayMutation = useOverlayMutation(QUERY_KEY);
  const [dialog, setDialog] = React.useState<
    | { mode: "create" }
    | { mode: "edit"; row: GuideRow }
    | { mode: "override"; row: GuideRow }
    | null
  >(null);
  const [deleteRow, setDeleteRow] = React.useState<GuideRow | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      settingsFetch(`/api/crm/knowledge/guides/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("toasts.deactivated"));
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const allRows = listQuery.data?.rows ?? [];
  const rows = q
    ? allRows.filter(
        (r) =>
          r.matchPrefix.toLowerCase().includes(q) ||
          r.titleRu.toLowerCase().includes(q) ||
          (r.titleUz ?? "").toLowerCase().includes(q),
      )
    : allRows;

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
          {t("guides.add")}
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <EmptyState text={t("guides.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  {t("guides.columns.prefix")}
                </TableHead>
                <TableHead>{t("guides.columns.title")}</TableHead>
                <TableHead className="w-28">
                  {t("guides.columns.followUp")}
                </TableHead>
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
                  <TableCell className="font-mono text-xs">
                    {row.matchPrefix}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.titleRu}</div>
                    {row.titleUz ? (
                      <div className="text-xs text-muted-foreground">
                        {row.titleUz}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.defaultFollowUpDays
                      ? t("guides.followUpDays", {
                          days: row.defaultFollowUpDays,
                        })
                      : "—"}
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
                                entityType: "GUIDE",
                                entityCode: row.code,
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
        <GuideDialog state={dialog} onClose={() => setDialog(null)} />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteRow !== null}
        onOpenChange={(v) => !v && setDeleteRow(null)}
        title={t("guides.deleteTitle")}
        description={deleteRow ? deleteRow.titleRu : undefined}
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

function GuideDialog({
  state,
  onClose,
}: {
  state:
    | { mode: "create" }
    | { mode: "edit"; row: GuideRow }
    | { mode: "override"; row: GuideRow };
  onClose: () => void;
}) {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();
  const row = state.mode === "create" ? null : state.row;
  const isOverride = state.mode === "override";

  const [form, setForm] = React.useState(() => ({
    matchPrefix: row?.matchPrefix ?? "",
    titleRu: row?.titleRu ?? "",
    titleUz: row?.titleUz ?? "",
    whatToDoRu: row?.whatToDoRu ?? "",
    whatToDoUz: row?.whatToDoUz ?? "",
    careRu: row?.careRu ?? "",
    careUz: row?.careUz ?? "",
    lifestyleRu: row?.lifestyleRu ?? "",
    lifestyleUz: row?.lifestyleUz ?? "",
    redFlagsRu: row?.redFlagsRu ?? "",
    redFlagsUz: row?.redFlagsUz ?? "",
    adviceChips: listToText(row?.adviceChips),
    defaultFollowUpDays: row?.defaultFollowUpDays?.toString() ?? "",
  }));

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const parseFollowUp = (): number | null => {
    const n = Number.parseInt(form.defaultFollowUpDays, 10);
    return Number.isFinite(n) && n >= 1 && n <= 365 ? n : null;
  };

  const blockValues = () => {
    const out: Record<BlockKey, string | null> = {} as Record<
      BlockKey,
      string | null
    >;
    for (const [ru, uz] of BLOCK_PAIRS) {
      out[ru] = form[ru].trim() || null;
      out[uz] = form[uz].trim() || null;
    }
    return out;
  };

  const overlayMutation = useOverlayMutation(QUERY_KEY, onClose);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        matchPrefix: form.matchPrefix.trim(),
        titleRu: form.titleRu.trim(),
        titleUz: form.titleUz.trim() || null,
        ...blockValues(),
        adviceChips: textToList(form.adviceChips),
        defaultFollowUpDays: parseFollowUp(),
      };
      return state.mode === "create"
        ? settingsFetch("/api/crm/knowledge/guides", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : settingsFetch(`/api/crm/knowledge/guides/${state.row.id}`, {
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
    onError: (e: Error) => toast.error(e.message),
  });

  const saveOverride = () =>
    overlayMutation.mutate(
      {
        entityType: "GUIDE",
        entityCode: state.mode === "override" ? state.row.code : "",
        overrides: {
          titleRu: form.titleRu.trim(),
          titleUz: form.titleUz.trim() || null,
          ...blockValues(),
          adviceChips: textToList(form.adviceChips),
          defaultFollowUpDays: parseFollowUp(),
        },
      },
      { onSuccess: () => toast.success(t("toasts.overrideSaved")) },
    );

  const resetOverride = () =>
    overlayMutation.mutate(
      {
        entityType: "GUIDE",
        entityCode: state.mode === "override" ? state.row.code : "",
        overrides: null,
      },
      { onSuccess: () => toast.success(t("toasts.overrideReset")) },
    );

  const pending = saveMutation.isPending || overlayMutation.isPending;
  const canSubmit = isOverride
    ? form.titleRu.trim().length > 0
    : form.matchPrefix.trim().length > 0 && form.titleRu.trim().length > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "create"
              ? t("guides.add")
              : state.mode === "edit"
                ? t("guides.editTitle")
                : t("guides.overrideTitle")}
          </DialogTitle>
        </DialogHeader>

        {isOverride ? (
          <p className="rounded-md bg-info/10 px-3 py-2 text-xs text-foreground">
            {t("overrideNote")}
          </p>
        ) : null}

        <div className="space-y-3 py-2">
          {isOverride && row ? (
            <div className="text-xs text-muted-foreground">
              {t("guides.fields.matchPrefix")}:{" "}
              <strong className="font-mono">{row.matchPrefix}</strong>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t("guides.fields.matchPrefix")}
                hint={t("guides.fields.matchPrefixHint")}
              >
                <Input
                  value={form.matchPrefix}
                  onChange={(e) => set("matchPrefix", e.target.value)}
                  placeholder="G43"
                />
              </Field>
              <Field label={t("guides.fields.followUpDays")}>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={form.defaultFollowUpDays}
                  onChange={(e) => set("defaultFollowUpDays", e.target.value)}
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("guides.fields.titleRu")}>
              <Input
                value={form.titleRu}
                onChange={(e) => set("titleRu", e.target.value)}
              />
            </Field>
            <Field label={t("guides.fields.titleUz")}>
              <Input
                value={form.titleUz}
                onChange={(e) => set("titleUz", e.target.value)}
              />
            </Field>
          </div>

          {BLOCK_PAIRS.map(([ru, uz]) => (
            <div key={ru} className="grid grid-cols-2 gap-3">
              <Field label={t(`guides.fields.${ru}`)}>
                <Textarea
                  rows={3}
                  value={form[ru]}
                  onChange={(e) => set(ru, e.target.value)}
                />
              </Field>
              <Field label={t(`guides.fields.${uz}`)}>
                <Textarea
                  rows={3}
                  value={form[uz]}
                  onChange={(e) => set(uz, e.target.value)}
                />
              </Field>
            </div>
          ))}

          <Field
            label={t("guides.fields.adviceChips")}
            hint={t("hints.linePerItem")}
          >
            <Textarea
              rows={3}
              value={form.adviceChips}
              onChange={(e) => set("adviceChips", e.target.value)}
            />
          </Field>

          {isOverride ? (
            <Field label={t("guides.fields.followUpDays")}>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.defaultFollowUpDays}
                onChange={(e) => set("defaultFollowUpDays", e.target.value)}
                className="max-w-32"
              />
            </Field>
          ) : null}
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
