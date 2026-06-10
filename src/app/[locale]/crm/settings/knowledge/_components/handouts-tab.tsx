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

type HandoutRow = {
  id: string;
  code: string;
  titleRu: string;
  titleUz: string | null;
  summaryRu: string | null;
  bodyMd: string;
  bodyMdUz: string | null;
  matchPrefixes: string[];
  topic: string | null;
  sortOrder: number;
  clinicId: string | null;
  clinicOverridden: boolean;
  hiddenByClinic: boolean;
};

const QUERY_KEY = ["settings", "knowledge", "handouts"] as const;

export function HandoutsTab() {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const q = React.useDeferredValue(search.trim());
  const listQuery = useQuery({
    queryKey: [...QUERY_KEY, q],
    queryFn: () =>
      settingsFetch<{ templates: HandoutRow[]; total: number }>(
        `/api/crm/catalogs/handouts?includeHidden=1${
          q ? `&q=${encodeURIComponent(q)}` : ""
        }`,
      ),
  });

  const overlayMutation = useOverlayMutation(QUERY_KEY);
  const [dialog, setDialog] = React.useState<
    | { mode: "create" }
    | { mode: "edit"; row: HandoutRow }
    | { mode: "override"; row: HandoutRow }
    | null
  >(null);
  const [deleteRow, setDeleteRow] = React.useState<HandoutRow | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      settingsFetch(`/api/crm/knowledge/handouts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("toasts.deactivated"));
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQuery.data?.templates ?? [];

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
          {t("handouts.add")}
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <EmptyState text={t("handouts.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("handouts.columns.title")}</TableHead>
                <TableHead className="w-36">
                  {t("handouts.columns.topic")}
                </TableHead>
                <TableHead className="w-32">
                  {t("handouts.columns.prefixes")}
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
                  <TableCell>
                    <div className="font-medium">{row.titleRu}</div>
                    {row.titleUz ? (
                      <div className="text-xs text-muted-foreground">
                        {row.titleUz}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.topic ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.matchPrefixes.join(", ") || "—"}
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
                                entityType: "HANDOUT",
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
        <HandoutDialog state={dialog} onClose={() => setDialog(null)} />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteRow !== null}
        onOpenChange={(v) => !v && setDeleteRow(null)}
        title={t("handouts.deleteTitle")}
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

function HandoutDialog({
  state,
  onClose,
}: {
  state:
    | { mode: "create" }
    | { mode: "edit"; row: HandoutRow }
    | { mode: "override"; row: HandoutRow };
  onClose: () => void;
}) {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();
  const row = state.mode === "create" ? null : state.row;
  const isOverride = state.mode === "override";

  const [form, setForm] = React.useState(() => ({
    titleRu: row?.titleRu ?? "",
    titleUz: row?.titleUz ?? "",
    summaryRu: row?.summaryRu ?? "",
    topic: row?.topic ?? "",
    matchPrefixes: listToText(row?.matchPrefixes),
    bodyMd: row?.bodyMd ?? "",
    bodyMdUz: row?.bodyMdUz ?? "",
  }));

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const overlayMutation = useOverlayMutation(QUERY_KEY, onClose);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        titleRu: form.titleRu.trim(),
        titleUz: form.titleUz.trim() || null,
        summaryRu: form.summaryRu.trim() || null,
        topic: form.topic.trim() || null,
        matchPrefixes: textToList(form.matchPrefixes),
        bodyMd: form.bodyMd,
        bodyMdUz: form.bodyMdUz.trim() || null,
      };
      return state.mode === "create"
        ? settingsFetch("/api/crm/knowledge/handouts", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : settingsFetch(`/api/crm/knowledge/handouts/${state.row.id}`, {
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
        entityType: "HANDOUT",
        entityCode: state.mode === "override" ? state.row.code : "",
        overrides: {
          titleRu: form.titleRu.trim(),
          titleUz: form.titleUz.trim() || null,
          summaryRu: form.summaryRu.trim() || null,
          topic: form.topic.trim() || null,
          bodyMd: form.bodyMd,
          bodyMdUz: form.bodyMdUz.trim() || null,
        },
      },
      { onSuccess: () => toast.success(t("toasts.overrideSaved")) },
    );

  const resetOverride = () =>
    overlayMutation.mutate(
      {
        entityType: "HANDOUT",
        entityCode: state.mode === "override" ? state.row.code : "",
        overrides: null,
      },
      { onSuccess: () => toast.success(t("toasts.overrideReset")) },
    );

  const pending = saveMutation.isPending || overlayMutation.isPending;
  const canSubmit =
    form.titleRu.trim().length > 0 && form.bodyMd.trim().length > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "create"
              ? t("handouts.add")
              : state.mode === "edit"
                ? t("handouts.editTitle")
                : t("handouts.overrideTitle")}
          </DialogTitle>
        </DialogHeader>

        {isOverride ? (
          <p className="rounded-md bg-info/10 px-3 py-2 text-xs text-foreground">
            {t("overrideNote")}
          </p>
        ) : null}

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("handouts.fields.titleRu")}>
              <Input
                value={form.titleRu}
                onChange={(e) => set("titleRu", e.target.value)}
              />
            </Field>
            <Field label={t("handouts.fields.titleUz")}>
              <Input
                value={form.titleUz}
                onChange={(e) => set("titleUz", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("handouts.fields.summaryRu")}>
              <Input
                value={form.summaryRu}
                onChange={(e) => set("summaryRu", e.target.value)}
              />
            </Field>
            <Field label={t("handouts.fields.topic")}>
              <Input
                value={form.topic}
                onChange={(e) => set("topic", e.target.value)}
              />
            </Field>
          </div>

          {!isOverride ? (
            <Field
              label={t("handouts.fields.matchPrefixes")}
              hint={t("hints.icdPerLine")}
            >
              <Textarea
                rows={2}
                value={form.matchPrefixes}
                onChange={(e) => set("matchPrefixes", e.target.value)}
                placeholder={"G43\nR51"}
              />
            </Field>
          ) : null}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={t("handouts.fields.bodyMd")}>
              <Textarea
                rows={12}
                value={form.bodyMd}
                onChange={(e) => set("bodyMd", e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
            <Field label={t("handouts.fields.bodyMdUz")}>
              <Textarea
                rows={12}
                value={form.bodyMdUz}
                onChange={(e) => set("bodyMdUz", e.target.value)}
                className="font-mono text-xs"
              />
            </Field>
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
