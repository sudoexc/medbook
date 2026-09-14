"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon, SearchIcon, UserIcon, XIcon } from "lucide-react";

import { parsePatientIdentity } from "@/lib/patients/parse-identity";

/**
 * Topbar search for the doctor.
 *
 * It used to be a mockup: the input held state and nothing else — no request,
 * no results, no navigation. The doctor noticed.
 *
 * Built around how he actually looks people up. He records patients as
 * «Турматов О 1969» and searches the same way, so the query is passed through
 * verbatim (the API understands a trailing year against `birthDate`), while a
 * digits-only string is treated as a phone. Results show the year and age,
 * because with ~100 similar surnames that is what tells two patients apart.
 *
 * Keyboard: ⌘K focuses, ↑/↓ move, Enter opens, Esc clears and closes.
 */
interface Hit {
  id: string;
  fullName: string;
  phone: string | null;
  birthDate: string | null;
  patientNumber: number | null;
}

function ageOf(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let y = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) y -= 1;
  return y >= 0 ? y : null;
}

export function DoctorSearch({ placeholder }: { placeholder: string }) {
  const t = useTranslations("doctor.nav.topbar");
  const locale = useLocale();
  const router = useRouter();

  const [value, setValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K focuses the field from anywhere in the cabinet.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close when clicking outside — the dropdown overlays the day's schedule.
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value.trim()), 200);
    return () => clearTimeout(id);
  }, [value]);

  const query = useQuery<Hit[], Error>({
    queryKey: ["doctor", "topbar-search", debounced],
    enabled: debounced.length >= 2,
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients?q=${encodeURIComponent(debounced)}&limit=8`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { rows?: Hit[] };
      return j.rows ?? [];
    },
    staleTime: 15_000,
  });

  const hits = query.data ?? [];

  React.useEffect(() => setActive(0), [debounced]);

  const go = (hit: Hit) => {
    setOpen(false);
    setValue("");
    router.push(`/${locale}/doctor/patients/${hit.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      setValue("");
      inputRef.current?.blur();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    }
  };

  // Echo how the query was understood: «Турматов 1969» → surname + year.
  const parsedQuery = parsePatientIdentity(debounced);
  const showYearHint = parsedQuery.matched && parsedQuery.fullName.length > 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-[480px]">
      <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-16 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
      <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {query.isFetching ? (
          <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
        ) : null}
        {value ? (
          <button
            type="button"
            onClick={() => {
              setValue("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label={t("clearSearch")}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        ) : (
          <kbd className="hidden h-6 select-none items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground md:inline-flex">
            ⌘K
          </kbd>
        )}
      </div>

      {open && debounced.length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          {showYearHint ? (
            <div className="border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
              {t("searchParsed", {
                name: parsedQuery.fullName,
                year: parsedQuery.birthYear!,
              })}
            </div>
          ) : null}

          {query.isLoading ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("searching")}
            </p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("searchEmpty")}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {hits.map((h, i) => {
                const age = ageOf(h.birthDate);
                const year = h.birthDate
                  ? new Date(h.birthDate).getFullYear()
                  : null;
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        go(h);
                      }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        i === active ? "bg-muted" : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <UserIcon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate text-sm font-medium text-foreground">
                            {h.fullName}
                          </span>
                          {year ? (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {t("searchYearAge", { year, age: age ?? 0 })}
                            </span>
                          ) : null}
                        </span>
                        {h.phone ? (
                          <span className="block truncate text-[11px] tabular-nums text-muted-foreground">
                            {h.phone}
                          </span>
                        ) : null}
                      </span>
                      {h.patientNumber ? (
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          №{h.patientNumber}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
