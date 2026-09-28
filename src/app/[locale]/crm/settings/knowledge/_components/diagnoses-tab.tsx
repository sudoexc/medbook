"use client";

/**
 * Audit CT-05 — the diagnosis wordings this clinic learned from practice.
 *
 * Every hand-written diagnosis a doctor picks joins every doctor's picker, so
 * a typo or a code-less wording one doctor used once stayed there for good.
 * The admin reviews them here: attach the ICD code a wording stands for, or
 * delete it. Notes already written keep their own copy either way.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, Trash2Icon } from "lucide-react";
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
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";

import { settingsFetch } from "../../_hooks/use-settings-api";
import { EmptyState, Field } from "./shared";

type DiagnosisRow = {
  id: string;
  code: string | null;
  nameRu: string;
  usageCount: number;
};

const QUERY_KEY = ["settings", "knowledge", "diagnoses"] as const;

/** Same shape the server accepts: «G43», «G43.0». */
const CODE_SHAPE = /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,3})?$/;

export function DiagnosesTab() {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const q = React.useDeferredValue(search.trim());
  const listQuery = useQuery({
    queryKey: [...QUERY_KEY, q],
    queryFn: () =>
      settingsFetch<{ rows: DiagnosisRow[]; total: number }>(
        `/api/crm/knowledge/diagnoses${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      ),
  });

  const [editRow, setEditRow] = React.useState<DiagnosisRow | null>(null);
  const [deleteRow, setDeleteRow] = React.useState<DiagnosisRow | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: QUERY_KEY });
    // The doctors' pickers cache searches for a minute; drop them so a
    // removed wording does not linger on this device.
    qc.invalidateQueries({ queryKey: ["icd10"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      settingsFetch(`/api/crm/knowledge/diagnoses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("diagnoses.deleted"));
      setDeleteRow(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQuery.data?.rows ?? [];

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("diagnoses.hint")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-xs"
        />
      </div>

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <EmptyState text={t("diagnoses.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("diagnoses.columns.name")}</TableHead>
                <TableHead className="w-28">{t("diagnoses.columns.code")}</TableHead>
                <TableHead className="w-28 text-right">
                  {t("diagnoses.columns.uses")}
                </TableHead>
                <TableHead className="w-24 text-right">
                  {t("columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.nameRu}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.code ?? (
                      <span className="font-sans text-muted-foreground">
                        {t("diagnoses.noCode")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.usageCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("actions.edit")}
                        onClick={() => setEditRow(row)}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("actions.delete")}
                        onClick={() => setDeleteRow(row)}
                      >
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editRow ? (
        <CodeDialog
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={invalidate}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleteRow !== null}
        onOpenChange={(v) => !v && setDeleteRow(null)}
        title={t("diagnoses.deleteTitle")}
        description={
          deleteRow ? (
            <>
              <span className="block font-medium text-foreground">
                {deleteRow.nameRu}
              </span>
              <span className="mt-1 block">{t("diagnoses.deleteHint")}</span>
            </>
          ) : undefined
        }
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

function CodeDialog({
  row,
  onClose,
  onSaved,
}: {
  row: DiagnosisRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("settings.knowledge");
  const [code, setCode] = React.useState(row.code ?? "");
  const normalized = code.trim().toUpperCase();
  const valid = normalized === "" || CODE_SHAPE.test(normalized);

  const saveMutation = useMutation({
    mutationFn: () =>
      settingsFetch(`/api/crm/knowledge/diagnoses/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ code: normalized || null }),
      }),
    onSuccess: () => {
      toast.success(t("toasts.saved"));
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("diagnoses.editTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-foreground">{row.nameRu}</p>
          <Field label={t("diagnoses.fields.code")} hint={t("diagnoses.fields.codeHint")}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="G43.0"
              className="font-mono"
              aria-invalid={!valid}
              autoFocus
            />
          </Field>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saveMutation.isPending}>
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !valid}
          >
            {saveMutation.isPending ? t("actions.saving") : t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
