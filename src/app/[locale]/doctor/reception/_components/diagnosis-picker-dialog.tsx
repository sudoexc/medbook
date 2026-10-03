"use client";

/**
 * The visit screen's diagnosis picker, mouse first.
 *
 * The clinic's request (03.10.2026): the doctor of this screen works with
 * the mouse, and the diagnosis field was a search box whose list opened only
 * once he clicked into it and typed. The left column is too narrow for three
 * lists side by side, so «+ Диагноз» (or the empty field) opens this wide
 * window with three columns, every diagnosis one click from the visit:
 *
 *   «Частые»      — what he writes most (his own visits, drafts included);
 *   «Мои»         — the codes he starred;
 *   «Каталог МКБ» — the classifier walked by clicks: chapter → block → codes
 *                   under their category's title (/api/crm/icd10/tree).
 *
 * «Добавить как: Основной / Сопутствующий» on top says what the next click
 * makes of it; it starts on «Основной» while the visit has no diagnosis and
 * turns to «Сопутствующий» once one is picked. The window stays open, so a
 * visit with two or three diagnoses is two or three clicks, and the visit's
 * diagnoses show at its top as they are added. Four stay the limit.
 *
 * The search stays, as an extra on top: typing swaps the columns for the
 * ICD-10 results, «код + название» and «записать как есть», until it is
 * cleared. On a phone the three columns become tabs over one list.
 *
 * Every pick is composed on the note as the doctor last left it (the query
 * cache, see diagnosis-list.ts), so two quick clicks never undo each other.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  Loader2Icon,
  PenLineIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ICD10_CHAPTERS } from "@/lib/icd10-chapters";
import { parseCodeNameQuery } from "@/lib/icd10-query";
import { visitDiagnosisKey } from "@/lib/visit-diagnoses";

import {
  defaultDiagnosisRole,
  diagnosisListOf,
  hasDiagnosis,
  MAX_VISIT_DIAGNOSES,
  withDiagnosisMadeMain,
  withDiagnosisPickedAs,
  withDiagnosisRemoved,
  type DiagnosisItem,
  type DiagnosisRole,
} from "../_hooks/diagnosis-list";
import {
  diagnosisOnVisitChecker,
  groupNodeRows,
  starredDiagnosisColumn,
} from "../_hooks/diagnosis-columns";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";
import { useIcd10Search } from "../_hooks/use-icd10";
import { useIcd10Node } from "../_hooks/use-icd10-tree";
import {
  useDiagnosisColumns,
  type DiagnosisShortItem,
} from "../_hooks/use-shortlists";
import type { VisitNotePatch, VisitNoteRow } from "../_hooks/use-visit-note";

type ColumnKey = "frequent" | "mine" | "catalog";

/** Where the «Каталог МКБ» column is: the chapters, then a chapter or block. */
type TrailStep = { range: string; title: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  note: VisitNoteRow;
  /** The note as the doctor last left it (the query cache). */
  liveNote: () => VisitNoteRow;
  /** Saves the whole new diagnosis set (replace-all). */
  onChange: (patch: VisitNotePatch) => void;
};

export function DiagnosisPickerDialog({
  open,
  onOpenChange,
  note,
  liveNote,
  onChange,
}: Props) {
  const t = useTranslations("doctor.reception");
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  const list = React.useMemo(
    () =>
      diagnosisListOf({
        diagnosisCode: note.diagnosisCode,
        diagnosisName: note.diagnosisName,
        additionalDiagnoses: note.additionalDiagnoses,
      }),
    [note.diagnosisCode, note.diagnosisName, note.additionalDiagnoses],
  );
  const onVisit = React.useMemo(() => diagnosisOnVisitChecker(list), [list]);
  const full = list.length >= MAX_VISIT_DIAGNOSES;

  const [role, setRole] = React.useState<DiagnosisRole>("main");
  const [query, setQuery] = React.useState("");
  const [tab, setTab] = React.useState<ColumnKey>("frequent");
  // The catalog keeps its place between openings: a neurologist goes back
  // to the same block visit after visit.
  const [trail, setTrail] = React.useState<TrailStep[]>([]);

  // Every opening starts from what the visit holds: the main diagnosis
  // while it has none, an additional one after that; no old search.
  React.useEffect(() => {
    if (!open) return;
    setRole(defaultDiagnosisRole(liveNote()));
    setQuery("");
    // liveNote changes with every render of the host; only the opening counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const columns = useDiagnosisColumns(open);
  const { favorites, pinned, isLoading: favoritesLoading, toggle } =
    useDoctorFavorites("ICD10");
  // Codes starred in this window from the catalog or the search: the list
  // the server sent does not know their words yet, «Мои» must show them now.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const star = React.useCallback(
    (d: { code: string | null; name: string }) => {
      if (!d.code) return;
      const code = d.code.toUpperCase();
      setSeen((prev) => new Map(prev).set(code, d.name));
      toggle(code);
    },
    [toggle],
  );

  const frequent = columns.data?.frequent ?? NO_ROWS;
  const mine = React.useMemo(
    () =>
      starredDiagnosisColumn({
        favorites: favoritesLoading
          ? null
          : favorites.map((f) => f.entityCode),
        starred: columns.data?.starred ?? NO_ROWS,
        known: frequent,
        seen,
      }),
    [favoritesLoading, favorites, columns.data?.starred, frequent, seen],
  );

  const pick = (d: DiagnosisItem) => {
    const live = liveNote();
    const next = withDiagnosisPickedAs(live, d, role);
    if (!next) {
      if (hasDiagnosis(live, d)) toast.info(t("diagnosis.alreadyAdded"));
      else if (diagnosisListOf(live).length >= MAX_VISIT_DIAGNOSES) {
        toast.info(t("diagnosis.full", { max: MAX_VISIT_DIAGNOSES }));
      }
      return;
    }
    onChange(next);
    // A visit has one main diagnosis: the next click adds another one.
    setRole("additional");
    setQuery("");
  };

  const remove = (d: DiagnosisItem) => {
    const next = withDiagnosisRemoved(liveNote(), d);
    if (next) onChange(next);
  };
  const makeMain = (d: DiagnosisItem) => {
    const next = withDiagnosisMadeMain(liveNote(), d);
    if (next) onChange(next);
  };

  // A pick that would change nothing is not offered: the row shows why.
  const rowProps = (d: { code: string | null; name: string }) => ({
    code: d.code,
    name: d.name,
    added: onVisit(d),
    blocked: full,
    starred: d.code ? pinned.has(d.code.toUpperCase()) : null,
    onPick: () => pick({ code: d.code, name: d.name }),
    onStar: () => star(d),
  });

  const searching = query.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(92dvh,52rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
        showCloseButton={false}
        // The search takes the caret where there is a keyboard to type on;
        // on a touch screen it would only pop the keyboard up.
        initialFocus={() =>
          typeof window !== "undefined" &&
          window.matchMedia?.("(pointer: fine)").matches
            ? searchRef.current
            : true
        }
      >
        {/* ── Top: the visit's diagnoses, the role, the optional search ── */}
        <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <FileTextIcon className="size-4" />
            </span>
            <DialogTitle className="min-w-0 flex-1 text-lg font-semibold text-foreground">
              {t("diagnosis.picker.title")}
            </DialogTitle>
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
              {t("diagnosis.count", { n: list.length, max: MAX_VISIT_DIAGNOSES })}
            </span>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t("diagnosis.picker.close")}
              title={t("diagnosis.picker.close")}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-5" />
            </button>
          </div>
          <DialogDescription className="sr-only">
            {t("diagnosis.picker.description")}
          </DialogDescription>

          {list.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {list.map((d, i) => (
                <ChosenChip
                  key={visitDiagnosisKey(d) ?? `row-${i}`}
                  diagnosis={d}
                  main={i === 0}
                  onMakeMain={() => makeMain(d)}
                  onRemove={() => remove(d)}
                />
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium text-muted-foreground">
              {t("diagnosis.picker.addAs")}
            </span>
            <div
              role="radiogroup"
              aria-label={t("diagnosis.picker.addAs")}
              className="inline-grid grid-cols-2 gap-1 rounded-xl bg-muted p-1"
            >
              {(["main", "additional"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={role === r}
                  disabled={full}
                  onClick={() => setRole(r)}
                  className={cn(
                    "h-10 rounded-lg px-4 text-[15px] font-semibold transition-colors disabled:opacity-50",
                    role === r
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r === "main" ? t("diagnosis.main") : t("diagnosis.additional")}
                </button>
              ))}
            </div>
            {full ? (
              <span className="text-sm font-medium text-warning-text">
                {t("diagnosis.full", { max: MAX_VISIT_DIAGNOSES })}
              </span>
            ) : role === "main" && list.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                {t("diagnosis.picker.mainSwapHint")}
              </span>
            ) : null}
          </div>

          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("diagnosis.picker.searchPlaceholder")}
              className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-11 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("diagnosis.picker.searchClear")}
                title={t("diagnosis.picker.searchClear")}
                className="absolute right-1.5 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            ) : null}
          </div>
        </div>

        {/* ── The columns, or the search results ── */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 bg-muted/30 p-3">
          {searching ? (
            <SearchResults
              query={query}
              rowProps={rowProps}
              blocked={full}
              onPick={pick}
            />
          ) : (
            <>
              <div
                role="tablist"
                className="grid shrink-0 grid-cols-3 gap-1 rounded-xl bg-muted p-1 md:hidden"
              >
                {(["frequent", "mine", "catalog"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => setTab(key)}
                    className={cn(
                      "h-10 rounded-lg text-sm font-semibold transition-colors",
                      tab === key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(`diagnosis.picker.col.${key}`)}
                  </button>
                ))}
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
                <Column
                  title={t("diagnosis.picker.col.frequent")}
                  count={frequent.length}
                  visible={tab === "frequent"}
                >
                  {columns.isLoading ? (
                    <ColumnNote loading />
                  ) : frequent.length === 0 ? (
                    <ColumnNote>{t("diagnosis.picker.frequentEmpty")}</ColumnNote>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {frequent.map((d) => (
                        <DxRow
                          key={`f-${d.code ?? ""}|${d.name}`}
                          {...rowProps(d)}
                          meta={
                            d.count > 0
                              ? t("diagnosis.shortCount", { n: d.count })
                              : null
                          }
                        />
                      ))}
                    </ul>
                  )}
                </Column>

                <Column
                  title={t("diagnosis.picker.col.mine")}
                  count={mine.length}
                  visible={tab === "mine"}
                >
                  {columns.isLoading && mine.length === 0 ? (
                    <ColumnNote loading />
                  ) : mine.length === 0 ? (
                    <ColumnNote>{t("diagnosis.picker.mineEmpty")}</ColumnNote>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {mine.map((d) => (
                        <DxRow key={`m-${d.code ?? ""}`} {...rowProps(d)} />
                      ))}
                    </ul>
                  )}
                </Column>

                <CatalogColumn
                  visible={tab === "catalog"}
                  trail={trail}
                  onTrail={setTrail}
                  rowProps={rowProps}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Bottom: one big way out ── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-4 py-3">
          <p className="min-w-0 text-sm leading-snug text-muted-foreground">
            {t("diagnosis.picker.footerHint", { max: MAX_VISIT_DIAGNOSES })}
          </p>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <CheckIcon className="size-5" />
            {t("diagnosis.picker.done")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Stable empty list so the memos above do not recompute while loading.
const NO_ROWS: DiagnosisShortItem[] = [];

type RowProps = {
  code: string | null;
  name: string;
  added: boolean;
  /** The visit is full: nothing more can be added. */
  blocked: boolean;
  /** null: a diagnosis without a code cannot be starred. */
  starred: boolean | null;
  onPick: () => void;
  onStar: () => void;
};

// ── The visit's diagnoses, at the top ─────────────────────────────────

function ChosenChip({
  diagnosis,
  main,
  onMakeMain,
  onRemove,
}: {
  diagnosis: DiagnosisItem;
  main: boolean;
  onMakeMain: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("doctor.reception");
  const { code, name } = diagnosis;
  const words = name && name !== code ? name : null;
  return (
    <li
      className={cn(
        "flex min-h-11 max-w-full items-center gap-1.5 rounded-xl border py-1 pl-3 pr-1",
        main ? "border-primary/30 bg-primary/5" : "border-border bg-background",
      )}
    >
      <span
        className={cn(
          "shrink-0 text-xs font-semibold uppercase tracking-wide",
          main ? "text-primary" : "text-muted-foreground",
        )}
      >
        {main ? t("diagnosis.main") : t("diagnosis.additional")}
      </span>
      <span className="min-w-0 truncate text-[15px]" title={words ?? code ?? ""}>
        {code ? (
          <span className="mr-1.5 font-mono font-semibold text-primary">{code}</span>
        ) : null}
        {words ? <span className="text-foreground">{words}</span> : null}
      </span>
      {!main && (
        <button
          type="button"
          onClick={onMakeMain}
          title={t("diagnosis.makeMain")}
          aria-label={t("diagnosis.makeMain")}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        >
          <ArrowUpIcon className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        title={t("diagnosis.remove")}
        aria-label={t("diagnosis.remove")}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <XIcon className="size-4" />
      </button>
    </li>
  );
}

// ── Columns ───────────────────────────────────────────────────────────

/**
 * One column: a title over a list that scrolls on its own inside the
 * window, so the three end level whatever their length.
 */
function Column({
  title,
  count,
  visible,
  header,
  scrollKey,
  children,
}: {
  title: string;
  count?: number;
  /** On a phone only the active tab's column shows. */
  visible: boolean;
  /** Replaces the plain title (the catalog's way back). */
  header?: React.ReactNode;
  /** A new value scrolls the list back to its top (a new catalog level). */
  scrollKey?: string;
  children: React.ReactNode;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [scrollKey]);
  return (
    <section
      className={cn(
        "min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card md:flex",
        visible ? "flex" : "hidden",
      )}
    >
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3 py-1.5">
        {header ?? (
          <>
            <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
              {title}
            </h3>
            {count ? (
              <span className="shrink-0 rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            ) : null}
          </>
        )}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {children}
      </div>
    </section>
  );
}

function ColumnNote({
  loading,
  children,
}: {
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center px-4 text-center text-[15px] leading-snug text-muted-foreground">
      {loading ? <Loader2Icon className="size-5 animate-spin" /> : children}
    </div>
  );
}

/**
 * One diagnosis: the whole row is the add button, the star in its corner
 * pins the code to «Мои». Two sibling buttons, not one inside the other: a
 * click on the star must never add the diagnosis. A row already on the
 * visit stays where it is, marked, so the list never moves under the cursor.
 */
function DxRow({
  code,
  name,
  added,
  blocked,
  starred,
  onPick,
  onStar,
  meta,
}: RowProps & { meta?: string | null }) {
  const t = useTranslations("doctor.reception");
  const words = name && name !== code ? name : null;
  const disabled = added || blocked;
  return (
    <li className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        title={added ? t("diagnosis.picker.onVisit") : undefined}
        className={cn(
          "flex min-h-14 w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
          starred !== null && "pr-12",
          added
            ? "cursor-default bg-success/5"
            : blocked
              ? "cursor-not-allowed opacity-60"
              : "hover:bg-primary/5 active:bg-primary/10",
        )}
      >
        {added ? (
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" />
        ) : null}
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block break-words text-base leading-snug",
              added ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {code ? (
              <span
                className={cn(
                  "mr-2 font-mono font-semibold",
                  added ? "text-muted-foreground" : "text-primary",
                )}
              >
                {code}
              </span>
            ) : null}
            {words}
          </span>
          {meta ? (
            <span className="mt-0.5 block text-[13px] text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
      </button>
      {starred !== null ? (
        <button
          type="button"
          onClick={onStar}
          aria-pressed={starred}
          aria-label={
            starred ? t("diagnosis.picker.starRemove") : t("diagnosis.picker.starAdd")
          }
          title={
            starred ? t("diagnosis.picker.starRemove") : t("diagnosis.picker.starAdd")
          }
          className={cn(
            "absolute right-1 top-1.5 inline-flex size-10 items-center justify-center rounded-lg transition-colors",
            starred
              ? "text-amber-500 hover:bg-amber-500/10"
              : "text-muted-foreground/50 hover:bg-muted hover:text-amber-500",
          )}
        >
          <StarIcon className={cn("size-4", starred ? "fill-amber-400" : "")} />
        </button>
      ) : null}
    </li>
  );
}

// ── «Каталог МКБ» ─────────────────────────────────────────────────────

function CatalogColumn({
  visible,
  trail,
  onTrail,
  rowProps,
}: {
  visible: boolean;
  trail: TrailStep[];
  onTrail: (trail: TrailStep[]) => void;
  rowProps: (d: { code: string | null; name: string }) => RowProps;
}) {
  const t = useTranslations("doctor.reception");
  const tChapter = useTranslations("doctor.references.icd10.chapters");
  const here = trail.at(-1) ?? null;
  const node = useIcd10Node(here?.range ?? null);
  const groups = React.useMemo(
    () =>
      node.data ? groupNodeRows(node.data.rows, node.data.headings) : [],
    [node.data],
  );

  let header: React.ReactNode = null;
  let body: React.ReactNode;

  if (!here) {
    body = (
      <ul className="flex flex-col gap-0.5">
        {ICD10_CHAPTERS.map((c) => (
          <li key={c.id}>
            <GroupButton
              code={c.id}
              label={tChapter(c.id)}
              onClick={() => onTrail([{ range: c.id, title: tChapter(c.id) }])}
            />
          </li>
        ))}
      </ul>
    );
  } else {
    const parent = trail.length > 1 ? trail[trail.length - 2]! : null;
    header = (
      <button
        type="button"
        onClick={() => onTrail(trail.slice(0, -1))}
        title={parent ? parent.title : t("diagnosis.picker.chapters")}
        className="-ml-1.5 inline-flex min-h-10 min-w-0 flex-1 items-center gap-1 rounded-lg px-1.5 text-left text-[15px] font-semibold text-primary transition-colors hover:bg-primary/5"
      >
        <ChevronLeftIcon className="size-5 shrink-0" />
        <span className="min-w-0">
          <span className="block font-mono text-xs text-muted-foreground">
            {here.range}
          </span>
          <span className="line-clamp-2 leading-snug">{here.title}</span>
        </span>
      </button>
    );
    body = node.isLoading ? (
      <ColumnNote loading />
    ) : node.isError || !node.data ? (
      <button
        type="button"
        onClick={() => void node.refetch()}
        className="flex h-full min-h-32 w-full items-center justify-center px-4 text-center text-[15px] text-destructive"
      >
        {t("rx.picker.loadError")}
      </button>
    ) : (
      <>
        {node.data.blocks.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {node.data.blocks.map((b) => (
              <li key={b.range}>
                <GroupButton
                  code={b.range}
                  label={b.nameRu}
                  count={b.count}
                  onClick={() =>
                    onTrail([...trail, { range: b.range, title: b.nameRu }])
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {groups.map((g, i) => (
          <div
            key={g.heading?.code ?? `plain-${i}`}
            className={cn(
              (i > 0 || node.data!.blocks.length > 0) && "mt-2 border-t border-border/60 pt-2",
            )}
          >
            {g.heading ? (
              <p className="px-3 pb-1 text-[13px] font-semibold leading-snug text-muted-foreground">
                <span className="mr-1.5 font-mono">{g.heading.code}</span>
                {g.heading.nameRu}
              </p>
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {g.rows.map((r) => (
                <DxRow key={r.code} {...rowProps({ code: r.code, name: r.nameRu })} />
              ))}
            </ul>
          </div>
        ))}
      </>
    );
  }

  return (
    <Column
      title={t("diagnosis.picker.col.catalog")}
      visible={visible}
      header={header}
      scrollKey={here?.range ?? "root"}
    >
      {body}
    </Column>
  );
}

/** A chapter or a block: its range over its name, its size, a chevron. */
function GroupButton({
  code,
  label,
  count,
  onClick,
}: {
  code: string;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary/5 active:bg-primary/10"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-xs font-semibold tabular-nums text-primary">
          {code}
          {count != null ? (
            <span className="ml-1.5 font-sans font-normal text-muted-foreground">
              · {count}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block break-words text-[15px] font-medium leading-snug text-foreground">
          {label}
        </span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Search results ────────────────────────────────────────────────────

function SearchResults({
  query,
  rowProps,
  blocked,
  onPick,
}: {
  query: string;
  rowProps: (d: { code: string | null; name: string }) => RowProps;
  blocked: boolean;
  onPick: (d: DiagnosisItem) => void;
}) {
  const t = useTranslations("doctor.reception");
  const hits = useIcd10Search(query);
  const rows = hits.data ?? [];
  const typed = query.trim();
  const pair = parseCodeNameQuery(query);
  const extraClass =
    "flex min-h-14 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-base transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60";
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3 py-1.5">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
          {t("diagnosis.picker.results")}
        </h3>
        {hits.isFetching && (
          <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {/* «Nothing found» only for an answered search, not while the
            typing debounce runs. */}
        {hits.data !== undefined && rows.length === 0 && !hits.isFetching ? (
          <p className="px-3 py-3 text-[15px] text-muted-foreground">
            {t("diagnosis.picker.searchEmpty")}
          </p>
        ) : null}
        <ul className="flex flex-col gap-0.5">
          {rows.map((r) => (
            // A learned wording without a code has code "": several of
            // them would share a key (audit CT-05).
            <DxRow
              key={`${r.code}|${r.nameRu}`}
              {...rowProps({ code: r.code || null, name: r.nameRu })}
              meta={r.custom ? t("diagnosis.clinicBadge") : null}
            />
          ))}
        </ul>
        <div className="mt-1 flex flex-col gap-0.5 border-t border-border/60 pt-1">
          {/* «G43.81 Название»: code and words land together, as in the
              field's search. */}
          {pair ? (
            <button
              type="button"
              disabled={blocked}
              onClick={() => onPick({ code: pair.code, name: pair.name })}
              className={extraClass}
            >
              <span className="font-mono font-semibold text-primary">{pair.code}</span>
              <span className="text-foreground">{pair.name}</span>
            </button>
          ) : null}
          {/* Free text is first-class: the code is for statistics, the
              words make the document valid. */}
          <button
            type="button"
            disabled={blocked}
            onClick={() => onPick({ code: null, name: typed })}
            className={extraClass}
          >
            <PenLineIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-foreground">
              {t("diagnosis.useAsTyped", { text: typed })}
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}
