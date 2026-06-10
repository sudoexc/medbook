"use client";

/**
 * Phase G5 — handout library picker.
 *
 * Opens from the handout editor as a side drawer. Lists templates ranked
 * by diagnosis match → general → others, with a search box and topic
 * filter. Clicking a template offers two actions:
 *   - "Добавить" appends the body to the current handout draft (with a
 *     section break)
 *   - "Заменить" overwrites the entire draft
 *
 * Designed for fast browsing — most of the time the doctor picks one
 * matched template and appends. The full body shows in the right detail
 * pane before commit so they can sanity-check.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  BookOpenIcon,
  CheckIcon,
  FilterIcon,
  PlusIcon,
  ReplaceIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  useHandouts,
  type HandoutTemplateRow,
} from "../_hooks/use-handouts";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  diagnosisCode: string | null;
  /** Called with the chosen body and the merge mode the doctor picked. */
  onPick: (bodyMd: string, mode: "APPEND" | "REPLACE") => void;
};

export function HandoutLibraryDrawer({
  open,
  onOpenChange,
  diagnosisCode,
  onPick,
}: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [topicFilter, setTopicFilter] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<HandoutTemplateRow | null>(null);
  // Ф4 — templates may carry an UZ body; the toggle controls both the
  // preview and which language Append/Replace inserts.
  const [lang, setLang] = React.useState<"ru" | "uz">("ru");

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(id);
  }, [query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setDebounced("");
      setTopicFilter(null);
      setSelected(null);
      setLang("ru");
    }
  }, [open]);

  const { data, isLoading } = useHandouts(debounced, diagnosisCode);
  const templates = data?.templates ?? [];

  const { pinned, toggle } = useDoctorFavorites("HANDOUT");

  const topics = React.useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.topic) set.add(t.topic);
    return [...set].sort();
  }, [templates]);

  const filtered = React.useMemo(() => {
    const base = topicFilter
      ? templates.filter((t) => t.topic === topicFilter)
      : templates;
    if (pinned.size === 0) return base;
    // Pinned favourites float above the dx-matched bucket — explicit user
    // pick beats the heuristic match.
    const pin: HandoutTemplateRow[] = [];
    const rest: HandoutTemplateRow[] = [];
    for (const t of base) (pinned.has(t.code) ? pin : rest).push(t);
    return [...pin, ...rest];
  }, [topicFilter, templates, pinned]);

  const activeBody =
    selected && lang === "uz" && selected.bodyMdUz
      ? selected.bodyMdUz
      : selected?.bodyMd ?? "";

  const handleAppend = () => {
    if (!selected) return;
    onPick(activeBody, "APPEND");
    onOpenChange(false);
  };
  const handleReplace = () => {
    if (!selected) return;
    onPick(activeBody, "REPLACE");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pb-3 pt-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <BookOpenIcon className="size-4" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">{t("handout.title")}</DialogTitle>
              <DialogDescription className="text-xs">
                {t("handout.description")}
              </DialogDescription>
            </div>
            {diagnosisCode && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                {diagnosisCode}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="grid h-[560px] grid-cols-[320px,1fr] border-y">
          {/* Left — list */}
          <div className="flex flex-col overflow-hidden border-r">
            <div className="border-b px-3 py-2">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  placeholder={t("handout.searchPlaceholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {topics.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setTopicFilter(null)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors",
                      topicFilter === null
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <FilterIcon className="size-2.5" />
                    {t("handout.allTopics")}
                  </button>
                  {topics.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() => setTopicFilter(topic === topicFilter ? null : topic)}
                      className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[10px] transition-colors",
                        topic === topicFilter
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {isLoading ? (
                <p className="px-2 text-xs text-muted-foreground">{t("common.loading")}</p>
              ) : filtered.length === 0 ? (
                <p className="px-2 text-xs text-muted-foreground">
                  {t("handout.empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {filtered.map((tpl) => {
                    const isPicked = selected?.id === tpl.id;
                    const isPinned = pinned.has(tpl.code);
                    return (
                      <li key={tpl.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(tpl);
                            setLang("ru");
                          }}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 pr-7 text-left text-xs transition-colors",
                            isPicked
                              ? "border-primary/40 bg-primary/5"
                              : "border-transparent hover:border-border hover:bg-muted/50",
                          )}
                        >
                          {isPinned ? (
                            <StarIcon className="mt-0.5 size-3 shrink-0 fill-amber-400 text-amber-500" />
                          ) : tpl.matched ? (
                            <StarIcon className="mt-0.5 size-3 shrink-0 text-amber-500" />
                          ) : null}
                          <div className="flex-1">
                            <div className="font-semibold text-foreground">
                              {tpl.titleRu}
                            </div>
                            {tpl.summaryRu && (
                              <div className="text-[11px] text-muted-foreground">
                                {tpl.summaryRu}
                              </div>
                            )}
                            {tpl.topic && (
                              <div className="mt-0.5 inline-block rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                                {tpl.topic}
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(tpl.code);
                          }}
                          title={isPinned ? t("favorites.remove") : t("favorites.add")}
                          className={cn(
                            "absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded-md transition-colors",
                            isPinned
                              ? "text-amber-500 hover:bg-amber-100"
                              : "text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-amber-500 group-hover:opacity-100",
                          )}
                        >
                          <StarIcon
                            className={cn(
                              "size-3",
                              isPinned ? "fill-amber-400" : "",
                            )}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right — preview */}
          <div className="flex flex-col overflow-hidden">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
                {t("handout.previewHint")}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs">
                  <div>
                    <div className="font-semibold text-foreground">
                      {selected.titleRu}
                    </div>
                    {selected.summaryRu && (
                      <div className="text-[11px] text-muted-foreground">
                        {selected.summaryRu}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selected.bodyMdUz ? (
                      <div className="inline-flex overflow-hidden rounded-md border border-border">
                        {(["ru", "uz"] as const).map((l) => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => setLang(l)}
                            className={cn(
                              "px-1.5 py-0.5 text-[10px] font-semibold uppercase transition-colors",
                              lang === l
                                ? "bg-primary/10 text-primary"
                                : "bg-card text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <code className="rounded-md bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                      {selected.code}
                    </code>
                  </div>
                </div>
                <pre className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed text-foreground">
                  {activeBody}
                </pre>
                <div className="flex items-center justify-end gap-2 border-t px-4 py-2">
                  <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    {t("actions.cancel")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReplace} className="gap-1">
                    <ReplaceIcon className="size-3.5" />
                    {t("handout.replace")}
                  </Button>
                  <Button size="sm" onClick={handleAppend} className="gap-1">
                    <PlusIcon className="size-3.5" />
                    {t("handout.append")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
