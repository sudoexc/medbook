"use client";

/**
 * Phase G3 — lab order builder.
 *
 * Search the catalog (tests + panels), assemble a basket, set urgency, then
 * create the LabOrder + open the printable направление in a new tab. The
 * dialog opens above the active visit (we read patient + appointment +
 * visitNote ids from ReceptionContext on click) so the doctor doesn't have
 * to re-pick anything.
 *
 * Preselect mode: callers can pass `initialTestCodes` (from a clinical
 * protocol's `recommendedLabs`) — those codes land in the basket on open.
 */
import * as React from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
  FlaskConicalIcon,
  Loader2Icon,
  LayersIcon,
  PrinterIcon,
  SearchIcon,
  StarIcon,
  TestTube2Icon,
  XIcon,
  ZapIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  useCreateLabOrder,
  useLabCatalog,
  type LabPanelRow,
  type LabTestRow,
} from "../_hooks/use-lab-catalog";
import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Required to actually create an order; if missing we render a hint. */
  patientId: string | null;
  appointmentId: string | null;
  visitNoteId: string | null;
  /** ICD-10 code from the active visit note — used to rank "common for this dx" tests. */
  diagnosisCode: string | null;
  /**
   * Pre-fill the basket from a protocol's recommendedLabs. Codes starting
   * with `PANEL_` land in the panel basket; everything else in the test
   * basket. Unknown codes stay until the catalog filters them out at submit.
   */
  initialTestCodes?: string[];
};

type Urgency = "ROUTINE" | "URGENT" | "STAT";

export function LabOrderDialog({
  open,
  onOpenChange,
  patientId,
  appointmentId,
  visitNoteId,
  diagnosisCode,
  initialTestCodes,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [pickedTests, setPickedTests] = React.useState<Set<string>>(new Set());
  const [pickedPanels, setPickedPanels] = React.useState<Set<string>>(new Set());
  const [urgency, setUrgency] = React.useState<Urgency>("ROUTINE");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 150);
    return () => window.clearTimeout(id);
  }, [query]);

  // Reset state every time the dialog opens fresh.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setDebounced("");
      setUrgency("ROUTINE");
      setNotes("");
      const initialPanels = new Set<string>();
      const initialTests = new Set<string>();
      for (const code of initialTestCodes ?? []) {
        if (code.startsWith("PANEL_")) initialPanels.add(code);
        else initialTests.add(code);
      }
      setPickedPanels(initialPanels);
      setPickedTests(initialTests);
    }
  }, [open, initialTestCodes]);

  const catalog = useLabCatalog(debounced, diagnosisCode);
  const create = useCreateLabOrder();

  const testFavs = useDoctorFavorites("LAB_TEST");
  const panelFavs = useDoctorFavorites("LAB_PANEL");

  // Pinned items float to the top of each section so a doctor's repeat
  // orderables (CBC, lipid, OAM…) stay above the rest of the catalog.
  const tests = React.useMemo(() => {
    const all = catalog.data?.tests ?? [];
    if (testFavs.pinned.size === 0) return all;
    const pin: LabTestRow[] = [];
    const rest: LabTestRow[] = [];
    for (const t of all) (testFavs.pinned.has(t.code) ? pin : rest).push(t);
    return [...pin, ...rest];
  }, [catalog.data?.tests, testFavs.pinned]);
  const panels = React.useMemo(() => {
    const all = catalog.data?.panels ?? [];
    if (panelFavs.pinned.size === 0) return all;
    const pin: LabPanelRow[] = [];
    const rest: LabPanelRow[] = [];
    for (const p of all) (panelFavs.pinned.has(p.code) ? pin : rest).push(p);
    return [...pin, ...rest];
  }, [catalog.data?.panels, panelFavs.pinned]);

  const toggleTest = (code: string) => {
    setPickedTests((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };
  const togglePanel = (code: string) => {
    setPickedPanels((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const basketTotal = pickedTests.size + pickedPanels.size;

  // Resolve picked codes to display names. We always have at least an
  // approximate "loaded the catalog once" set — if the user filtered the
  // search down, picked items stay in the basket as codes.
  const allTestsByCode = React.useMemo(() => {
    const map = new Map<string, LabTestRow>();
    for (const t of tests) map.set(t.code, t);
    return map;
  }, [tests]);
  const allPanelsByCode = React.useMemo(() => {
    const map = new Map<string, LabPanelRow>();
    for (const p of panels) map.set(p.code, p);
    return map;
  }, [panels]);

  const canSubmit =
    basketTotal > 0 && !!patientId && !create.isPending;

  const handleSubmit = async () => {
    if (!patientId) return;
    try {
      const created = await create.mutateAsync({
        patientId,
        appointmentId,
        visitNoteId,
        testCodes: [...pickedTests],
        panelCodes: [...pickedPanels],
        diagnosisCode,
        notes: notes.trim() || null,
        urgency,
      });
      // Open print form in a new tab — the route flips printedAt and renders
      // a window.print() call on load.
      window.open(`/api/crm/lab-orders/${created.id}/print`, "_blank");
      onOpenChange(false);
    } catch {
      // mutation `error` is rendered inline; swallow here.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl gap-0 overflow-hidden p-0">
        <DialogHeader className="px-5 pb-3 pt-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FlaskConicalIcon className="size-4" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-base">
                Лабораторная заявка
              </DialogTitle>
              <DialogDescription className="text-xs">
                Подберите тесты или панели → создаём направление с QR.
              </DialogDescription>
            </div>
            {diagnosisCode && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                {diagnosisCode}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="grid h-[560px] grid-cols-[1fr,320px] border-y">
          {/* Left — search + lists */}
          <div className="flex flex-col overflow-hidden">
            <div className="border-b px-4 py-2">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Поиск по коду или названию (CBC, глюкоза, тиреоидная панель…)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {catalog.isLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3 animate-spin" />
                  Загружаем каталог…
                </div>
              ) : (
                <>
                  {panels.length > 0 && (
                    <div className="mb-3">
                      <div className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                        <LayersIcon className="size-3" />
                        Панели
                        <span className="rounded-md bg-muted px-1 text-[10px] text-muted-foreground">
                          {panels.length}
                        </span>
                      </div>
                      <ul className="space-y-1">
                        {panels.map((p) => {
                          const picked = pickedPanels.has(p.code);
                          const isPinned = panelFavs.pinned.has(p.code);
                          return (
                            <li key={p.id} className="group relative">
                              <button
                                type="button"
                                onClick={() => togglePanel(p.code)}
                                className={cn(
                                  "flex w-full items-start gap-2 rounded-md border px-2 py-1.5 pr-7 text-left text-xs transition-colors",
                                  picked
                                    ? "border-primary/40 bg-primary/5"
                                    : "border-border hover:border-primary/30 hover:bg-muted/50",
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border",
                                    picked
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-card",
                                  )}
                                >
                                  {picked ? <CheckIcon className="size-3" /> : null}
                                </span>
                                <span className="flex-1">
                                  <span className="flex items-center gap-1.5">
                                    {isPinned ? (
                                      <StarIcon className="size-3 shrink-0 fill-amber-400 text-amber-500" />
                                    ) : null}
                                    <span className="font-semibold text-foreground">
                                      {p.nameRu}
                                    </span>
                                    <code className="rounded-md bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                                      {p.code}
                                    </code>
                                    <span className="text-[10px] text-muted-foreground">
                                      {p.testCodes.length} тестов
                                    </span>
                                  </span>
                                  {p.description && (
                                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                      {p.description}
                                    </span>
                                  )}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  panelFavs.toggle(p.code);
                                }}
                                title={isPinned ? "Снять из избранного" : "В избранное"}
                                className={cn(
                                  "absolute right-1 top-1.5 inline-flex size-5 items-center justify-center rounded-md transition-colors",
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
                    </div>
                  )}

                  <div>
                    <div className="mb-1.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                      <TestTube2Icon className="size-3" />
                      Тесты
                      <span className="rounded-md bg-muted px-1 text-[10px] text-muted-foreground">
                        {tests.length}
                      </span>
                    </div>
                    {tests.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Ничего не найдено. Попробуйте другой запрос.
                      </p>
                    ) : (
                      <ul className="space-y-0.5">
                        {tests.map((t) => {
                          const picked = pickedTests.has(t.code);
                          const isPinned = testFavs.pinned.has(t.code);
                          const recommended =
                            diagnosisCode &&
                            t.commonForCodes.some((c) =>
                              diagnosisCode.toUpperCase().startsWith(c.toUpperCase()),
                            );
                          return (
                            <li key={t.id} className="group relative">
                              <button
                                type="button"
                                onClick={() => toggleTest(t.code)}
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 pr-7 text-left text-xs transition-colors",
                                  picked
                                    ? "border-primary/40 bg-primary/5"
                                    : "border-border hover:border-primary/30 hover:bg-muted/50",
                                )}
                              >
                                <span
                                  className={cn(
                                    "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                                    picked
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-card",
                                  )}
                                >
                                  {picked ? <CheckIcon className="size-3" /> : null}
                                </span>
                                <code className="rounded-md bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                                  {t.code}
                                </code>
                                <span className="flex flex-1 items-center gap-1 truncate text-foreground">
                                  {isPinned ? (
                                    <StarIcon className="size-3 shrink-0 fill-amber-400 text-amber-500" />
                                  ) : null}
                                  <span className="truncate">{t.nameRu}</span>
                                </span>
                                {t.unit && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {t.unit}
                                  </span>
                                )}
                                {recommended && (
                                  <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-100 px-1 text-[10px] font-medium text-amber-700">
                                    ★ рекомендуется
                                  </span>
                                )}
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <ClockIcon className="size-2.5" />
                                  {t.turnaroundHours}ч
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  testFavs.toggle(t.code);
                                }}
                                title={isPinned ? "Снять из избранного" : "В избранное"}
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
                </>
              )}
            </div>
          </div>

          {/* Right — basket + urgency + notes */}
          <div className="flex flex-col overflow-hidden border-l">
            <div className="border-b px-4 py-2 text-xs">
              <div className="mb-1.5 inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-foreground">
                Срочность
              </div>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: "ROUTINE", label: "Плановый", Icon: ClockIcon },
                    { id: "URGENT", label: "Срочно", Icon: ZapIcon },
                    { id: "STAT", label: "CITO", Icon: AlertTriangleIcon },
                  ] as { id: Urgency; label: string; Icon: typeof ClockIcon }[]
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setUrgency(id)}
                    className={cn(
                      "inline-flex h-7 items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors",
                      urgency === id
                        ? id === "STAT"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : id === "URGENT"
                            ? "border-amber-300 bg-amber-50 text-amber-700"
                            : "border-primary/30 bg-primary/5 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    <Icon className="size-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 text-xs">
              <div className="mb-1.5 inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-foreground">
                Корзина
                {basketTotal > 0 && (
                  <span className="rounded-md bg-primary/15 px-1 text-[10px] font-semibold text-primary">
                    {basketTotal}
                  </span>
                )}
              </div>

              {basketTotal === 0 ? (
                <p className="text-muted-foreground">
                  Пусто — выберите панели и/или тесты слева.
                </p>
              ) : (
                <ul className="space-y-1">
                  {[...pickedPanels].map((code) => {
                    const p = allPanelsByCode.get(code);
                    return (
                      <li
                        key={`p-${code}`}
                        className="flex items-start gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1"
                      >
                        <LayersIcon className="mt-0.5 size-3 text-primary" />
                        <div className="flex-1">
                          <div className="font-semibold text-foreground">
                            {p?.nameRu ?? code}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {p
                              ? p.testCodes.join(", ")
                              : "детали загрузятся при печати"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePanel(code)}
                          className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Убрать"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </li>
                    );
                  })}
                  {[...pickedTests].map((code) => {
                    const t = allTestsByCode.get(code);
                    return (
                      <li
                        key={`t-${code}`}
                        className="flex items-start gap-1.5 rounded-md border border-border bg-card px-2 py-1"
                      >
                        <TestTube2Icon className="mt-0.5 size-3 text-muted-foreground" />
                        <div className="flex-1">
                          <div className="font-semibold text-foreground">
                            <code className="mr-1 font-mono text-[10px] text-muted-foreground">
                              {code}
                            </code>
                            {t?.nameRu ?? ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleTest(code)}
                          className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Убрать"
                        >
                          <XIcon className="size-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-3">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  Примечание для лаборанта
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Например: пациент натощак"
                  rows={2}
                  className="w-full resize-none rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {create.error && (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                  {(create.error as Error).message}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 px-5 py-3">
          <p className="text-[11px] text-muted-foreground">
            {patientId
              ? "После создания откроется печатное направление с QR."
              : "Откройте активный приём, чтобы создать заявку."}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="gap-1"
            >
              {create.isPending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PrinterIcon className="size-3.5" />
              )}
              Создать и распечатать
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
