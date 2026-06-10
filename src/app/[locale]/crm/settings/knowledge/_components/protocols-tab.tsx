"use client";

/**
 * Ф4 — clinic-own protocols (doctorId null) reuse the Ф3 CRUD
 * (/api/crm/protocols). Globals are read-only (hide via overlay on the
 * ordering surfaces); doctors' personal protocols never show up here.
 * Only the descriptive fields are editable — prescriptionItems are built
 * from a real visit via «сохранить приём как протокол».
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

import { settingsFetch } from "../../_hooks/use-settings-api";
import { EmptyState, Field, listToText, textToList } from "./shared";

type ProtocolRow = {
  id: string;
  diagnosisCodePrefix: string;
  nameRu: string;
  nameUz: string | null;
  summaryRu: string | null;
  adviceTemplate: string[];
  recommendedLabs: string[];
  prescriptionItems: unknown;
  followUpDays: number | null;
  sortOrder: number;
  active: boolean;
};

const QUERY_KEY = ["settings", "knowledge", "protocols"] as const;

export function ProtocolsTab() {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();

  const [search, setSearch] = React.useState("");
  const q = React.useDeferredValue(search.trim().toLowerCase());
  const listQuery = useQuery({
    queryKey: [...QUERY_KEY],
    queryFn: () =>
      settingsFetch<{ rows: ProtocolRow[]; total: number }>(
        "/api/crm/protocols",
      ),
  });

  const [dialog, setDialog] = React.useState<
    { mode: "create" } | { mode: "edit"; row: ProtocolRow } | null
  >(null);

  const toggleMutation = useMutation({
    mutationFn: (payload: { id: string; active: boolean }) =>
      settingsFetch(`/api/crm/protocols/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: payload.active }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (e: Error) => toast.error(e.message),
  });

  const allRows = listQuery.data?.rows ?? [];
  const rows = q
    ? allRows.filter(
        (r) =>
          r.diagnosisCodePrefix.toLowerCase().includes(q) ||
          r.nameRu.toLowerCase().includes(q) ||
          (r.nameUz ?? "").toLowerCase().includes(q),
      )
    : allRows;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("protocols.scopeHint")}
      </p>
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
          {t("protocols.add")}
        </Button>
      </div>

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <EmptyState text={t("protocols.empty")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">
                  {t("guides.columns.prefix")}
                </TableHead>
                <TableHead>{t("protocols.columns.name")}</TableHead>
                <TableHead className="w-28">
                  {t("protocols.columns.items")}
                </TableHead>
                <TableHead className="w-28">
                  {t("guides.columns.followUp")}
                </TableHead>
                <TableHead className="w-32">
                  {t("protocols.columns.active")}
                </TableHead>
                <TableHead className="w-20 text-right">
                  {t("columns.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={!row.active ? "opacity-55" : undefined}
                >
                  <TableCell className="font-mono text-xs">
                    {row.diagnosisCodePrefix}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{row.nameRu}</div>
                    {row.nameUz ? (
                      <div className="text-xs text-muted-foreground">
                        {row.nameUz}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {Array.isArray(row.prescriptionItems) &&
                    row.prescriptionItems.length > 0 ? (
                      <Badge variant="secondary">
                        {row.prescriptionItems.length}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.followUpDays
                      ? t("guides.followUpDays", { days: row.followUpDays })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={row.active}
                      disabled={toggleMutation.isPending}
                      onCheckedChange={(v: boolean) =>
                        toggleMutation.mutate({ id: row.id, active: v })
                      }
                      aria-label={t("protocols.columns.active")}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("actions.edit")}
                      onClick={() => setDialog({ mode: "edit", row })}
                    >
                      <PencilIcon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {dialog ? (
        <ProtocolDialog state={dialog} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function ProtocolDialog({
  state,
  onClose,
}: {
  state: { mode: "create" } | { mode: "edit"; row: ProtocolRow };
  onClose: () => void;
}) {
  const t = useTranslations("settings.knowledge");
  const qc = useQueryClient();
  const row = state.mode === "create" ? null : state.row;

  const [form, setForm] = React.useState(() => ({
    diagnosisCodePrefix: row?.diagnosisCodePrefix ?? "",
    nameRu: row?.nameRu ?? "",
    nameUz: row?.nameUz ?? "",
    summaryRu: row?.summaryRu ?? "",
    adviceTemplate: listToText(row?.adviceTemplate),
    recommendedLabs: listToText(row?.recommendedLabs),
    followUpDays: row?.followUpDays?.toString() ?? "",
  }));

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const saveMutation = useMutation({
    mutationFn: () => {
      const n = Number.parseInt(form.followUpDays, 10);
      const payload = {
        diagnosisCodePrefix: form.diagnosisCodePrefix.trim(),
        nameRu: form.nameRu.trim(),
        nameUz: form.nameUz.trim() || null,
        summaryRu: form.summaryRu.trim() || null,
        adviceTemplate: textToList(form.adviceTemplate),
        recommendedLabs: textToList(form.recommendedLabs),
        followUpDays: Number.isFinite(n) && n >= 1 && n <= 365 ? n : null,
      };
      return state.mode === "create"
        ? settingsFetch("/api/crm/protocols", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : settingsFetch(`/api/crm/protocols/${state.row.id}`, {
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

  const canSubmit =
    form.diagnosisCodePrefix.trim().length > 0 &&
    form.nameRu.trim().length > 0;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state.mode === "create"
              ? t("protocols.add")
              : t("protocols.editTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("guides.fields.matchPrefix")}
              hint={t("guides.fields.matchPrefixHint")}
            >
              <Input
                value={form.diagnosisCodePrefix}
                onChange={(e) => set("diagnosisCodePrefix", e.target.value)}
                placeholder="J06"
              />
            </Field>
            <Field label={t("guides.fields.followUpDays")}>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.followUpDays}
                onChange={(e) => set("followUpDays", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("protocols.fields.nameRu")}>
              <Input
                value={form.nameRu}
                onChange={(e) => set("nameRu", e.target.value)}
              />
            </Field>
            <Field label={t("protocols.fields.nameUz")}>
              <Input
                value={form.nameUz}
                onChange={(e) => set("nameUz", e.target.value)}
              />
            </Field>
          </div>

          <Field label={t("protocols.fields.summaryRu")}>
            <Textarea
              rows={2}
              value={form.summaryRu}
              onChange={(e) => set("summaryRu", e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("protocols.fields.adviceTemplate")}
              hint={t("hints.linePerItem")}
            >
              <Textarea
                rows={3}
                value={form.adviceTemplate}
                onChange={(e) => set("adviceTemplate", e.target.value)}
              />
            </Field>
            <Field
              label={t("protocols.fields.recommendedLabs")}
              hint={t("hints.linePerItem")}
            >
              <Textarea
                rows={3}
                value={form.recommendedLabs}
                onChange={(e) => set("recommendedLabs", e.target.value)}
              />
            </Field>
          </div>

          {state.mode === "edit" ? (
            <p className="text-[11px] text-muted-foreground">
              {t("protocols.itemsHint")}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            {t("actions.cancel")}
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !canSubmit}
          >
            {saveMutation.isPending ? t("actions.saving") : t("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
