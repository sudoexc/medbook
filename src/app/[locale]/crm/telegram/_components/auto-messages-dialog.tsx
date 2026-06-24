"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2Icon, MegaphoneIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type AutoMessageKind = "welcome" | "reminder" | "thankYou";

type AutoMessage = {
  kind: AutoMessageKind;
  key: string;
  enabled: boolean;
  text: string;
  variables: string[];
};

const QUERY_KEY = ["auto-messages"] as const;

async function fetchAutoMessages(): Promise<AutoMessage[]> {
  const res = await fetch("/api/crm/settings/auto-messages", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const json = (await res.json()) as { messages: AutoMessage[] };
  return json.messages;
}

/**
 * «Авто-сообщения» — ADMIN widget to toggle and edit the three Telegram
 * automations (welcome / reminder / thank-you). Each maps to a
 * NotificationTemplate row; the dialog reads and writes via
 * /api/crm/settings/auto-messages. No parallel sender — the existing
 * materialise → send pipeline (and the bot FSM, for welcome) delivers them.
 */
export function AutoMessagesDialog() {
  const t = useTranslations("tgInbox.autoMessages");
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<AutoMessage[] | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAutoMessages,
    enabled: open,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (open && query.data && draft === null) setDraft(query.data);
  }, [open, query.data, draft]);

  const save = useMutation({
    mutationFn: async (
      messages: Array<{ kind: AutoMessageKind; enabled: boolean; text: string }>,
    ): Promise<AutoMessage[]> => {
      const res = await fetch("/api/crm/settings/auto-messages", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ messages }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const json = (await res.json()) as { messages: AutoMessage[] };
      return json.messages;
    },
    onSuccess: (messages) => {
      qc.setQueryData(QUERY_KEY, messages);
      setDraft(messages);
      toast.success(t("saved"));
    },
    onError: () => {
      toast.error(t("saveError"));
    },
  });

  const serverState = query.data ?? null;
  const dirty =
    draft && serverState
      ? draft.some((d, i) => {
          const s = serverState[i];
          return !s || d.enabled !== s.enabled || d.text !== s.text;
        })
      : false;

  const patch = (kind: AutoMessageKind, change: Partial<AutoMessage>) => {
    setDraft((prev) =>
      prev ? prev.map((m) => (m.kind === kind ? { ...m, ...change } : m)) : prev,
    );
  };

  const onSave = () => {
    if (!draft || !serverState) return;
    const changed = draft
      .filter((d, i) => {
        const s = serverState[i];
        return !s || d.enabled !== s.enabled || d.text !== s.text;
      })
      .map((d) => ({ kind: d.kind, enabled: d.enabled, text: d.text }));
    if (changed.length === 0) {
      setOpen(false);
      return;
    }
    save.mutate(changed);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setDraft(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => setOpen(true)}
      >
        <MegaphoneIcon aria-hidden />
        {t("trigger")}
      </Button>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {query.isLoading || !draft ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2Icon className="size-5 animate-spin" aria-hidden />
            </div>
          ) : query.isError ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t("loadError")}
            </div>
          ) : (
            draft.map((m) => (
              <div
                key={m.kind}
                className="space-y-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {t(`items.${m.kind}.title`)}
                    </div>
                    <p className="text-[12px] leading-snug text-muted-foreground">
                      {t(`items.${m.kind}.subtitle`)}
                    </p>
                  </div>
                  <Switch
                    checked={m.enabled}
                    onCheckedChange={(v) => patch(m.kind, { enabled: v })}
                    aria-label={t(`items.${m.kind}.title`)}
                  />
                </div>
                <Textarea
                  value={m.text}
                  onChange={(e) => patch(m.kind, { text: e.target.value })}
                  disabled={!m.enabled}
                  rows={m.kind === "welcome" ? 6 : 3}
                  className="text-[13px]"
                />
                {m.variables.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {t("placeholdersHint", {
                      keys: m.variables.map((v) => `{{${v}}}`).join(", "),
                    })}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={save.isPending}
          >
            {t("cancel")}
          </Button>
          <Button onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? (
              <Loader2Icon className="size-4 animate-spin" aria-hidden />
            ) : null}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
