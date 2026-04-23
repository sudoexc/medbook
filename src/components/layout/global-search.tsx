"use client";

/**
 * Global cmdk search dialog (TZ §6.0 top-bar search).
 *
 * Hits `GET /api/crm/search?q=...` and renders top-5 results in four groups:
 * patients / doctors / appointments / conversations.
 *
 * Opens on Cmd/Ctrl+K or when the topbar search button is clicked.
 * Each result is an internal link that closes the dialog and navigates.
 */

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import {
  CalendarIcon,
  MessageSquareIcon,
  StethoscopeIcon,
  UserIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// ---------------------------------------------------------------------------
// Response types & parser
// ---------------------------------------------------------------------------

export interface SearchPatient {
  id: string;
  fullName: string;
  phone: string | null;
}

export interface SearchDoctor {
  id: string;
  nameRu: string;
  nameUz: string | null;
  specializationRu: string | null;
}

export interface SearchAppointment {
  id: string;
  date: string;
  status: string;
  patient: { id: string; fullName: string; phone: string | null } | null;
  doctor: { id: string; nameRu: string; nameUz: string | null } | null;
}

export interface SearchConversation {
  id: string;
  channel: string;
  status: string;
  lastMessageText: string | null;
  patient: { id: string; fullName: string } | null;
}

export interface SearchResults {
  patients: SearchPatient[];
  doctors: SearchDoctor[];
  appointments: SearchAppointment[];
  conversations: SearchConversation[];
}

/**
 * Normalizes a raw /api/crm/search response to the shape our UI expects.
 * Tolerant: unknown keys fall back to empty arrays, malformed rows are dropped.
 * Exported for unit tests.
 */
export function parseSearchResults(raw: unknown): SearchResults {
  const r = (raw ?? {}) as Record<string, unknown>;
  const take = <T,>(key: string, mapper: (row: unknown) => T | null): T[] => {
    const arr = Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
    const out: T[] = [];
    for (const row of arr) {
      const m = mapper(row);
      if (m) out.push(m);
    }
    return out;
  };

  const asStr = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;

  return {
    patients: take<SearchPatient>("patients", (row) => {
      const o = (row ?? {}) as Record<string, unknown>;
      const id = asStr(o.id);
      const fullName = asStr(o.fullName);
      if (!id || !fullName) return null;
      return { id, fullName, phone: asStr(o.phone) };
    }),
    doctors: take<SearchDoctor>("doctors", (row) => {
      const o = (row ?? {}) as Record<string, unknown>;
      const id = asStr(o.id);
      const nameRu = asStr(o.nameRu);
      if (!id || !nameRu) return null;
      return {
        id,
        nameRu,
        nameUz: asStr(o.nameUz),
        specializationRu: asStr(o.specializationRu),
      };
    }),
    appointments: take<SearchAppointment>("appointments", (row) => {
      const o = (row ?? {}) as Record<string, unknown>;
      const id = asStr(o.id);
      const date = asStr(o.date);
      if (!id || !date) return null;
      const patient = o.patient as
        | { id?: unknown; fullName?: unknown; phone?: unknown }
        | undefined;
      const doctor = o.doctor as
        | { id?: unknown; nameRu?: unknown; nameUz?: unknown }
        | undefined;
      return {
        id,
        date,
        status: asStr(o.status) ?? "",
        patient:
          patient && asStr(patient.id) && asStr(patient.fullName)
            ? {
                id: patient.id as string,
                fullName: patient.fullName as string,
                phone: asStr(patient.phone),
              }
            : null,
        doctor:
          doctor && asStr(doctor.id) && asStr(doctor.nameRu)
            ? {
                id: doctor.id as string,
                nameRu: doctor.nameRu as string,
                nameUz: asStr(doctor.nameUz),
              }
            : null,
      };
    }),
    conversations: take<SearchConversation>("conversations", (row) => {
      const o = (row ?? {}) as Record<string, unknown>;
      const id = asStr(o.id);
      if (!id) return null;
      const patient = o.patient as
        | { id?: unknown; fullName?: unknown }
        | undefined;
      return {
        id,
        channel: asStr(o.channel) ?? "",
        status: asStr(o.status) ?? "",
        lastMessageText: asStr(o.lastMessageText),
        patient:
          patient && asStr(patient.id) && asStr(patient.fullName)
            ? {
                id: patient.id as string,
                fullName: patient.fullName as string,
              }
            : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the event target is a form field or contenteditable
 * surface — in which case we do NOT intercept `/` (the user is typing).
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Registers the global search hotkeys:
 *   - ⌘K / Ctrl+K — always fires (standard command-palette convention).
 *   - `/`         — fires only when the user is not typing in an input,
 *                   matching Gmail/GitHub behaviour (TZ §9.6: "Esc закрывает
 *                   модал, / фокусирует глобальный поиск").
 */
export function useGlobalSearchShortcut(open: () => void) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash =
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditableTarget(e.target);
      if (!isCmdK && !isSlash) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Cross-entity global search dialog. */
export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const t = useTranslations("search");
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults>({
    patients: [],
    doctors: [],
    appointments: [],
    conversations: [],
  });
  const [loading, setLoading] = React.useState(false);

  // Reset query when the dialog closes so next open is fresh.
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults({
        patients: [],
        doctors: [],
        appointments: [],
        conversations: [],
      });
    }
  }, [open]);

  // Debounced fetch
  React.useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 1) {
      setResults({
        patients: [],
        doctors: [],
        appointments: [],
        conversations: [],
      });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/crm/search?q=${encodeURIComponent(q)}`,
          { credentials: "include", signal: controller.signal },
        );
        if (!res.ok) {
          setResults({
            patients: [],
            doctors: [],
            appointments: [],
            conversations: [],
          });
          return;
        }
        const data = await res.json();
        setResults(parseSearchResults(data));
      } catch (e) {
        if ((e as { name?: string })?.name !== "AbortError") {
          // swallow — user is typing fast
        }
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open]);

  const go = (href: string) => {
    onOpenChange(false);
    router.push(`/${locale}${href}`);
  };

  const doctorName = (d: SearchDoctor) =>
    locale === "uz" && d.nameUz ? d.nameUz : d.nameRu;

  const dateFmt = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );

  const total =
    results.patients.length +
    results.doctors.length +
    results.appointments.length +
    results.conversations.length;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      description={t("description")}
    >
      <CommandInput
        placeholder={t("placeholder")}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {query.trim().length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t("typeToSearch")}
          </div>
        ) : total === 0 && !loading ? (
          <CommandEmpty>{t("noResults")}</CommandEmpty>
        ) : null}

        {results.patients.length > 0 ? (
          <CommandGroup heading={t("groups.patients")}>
            {results.patients.map((p) => (
              <CommandItem
                key={`p-${p.id}`}
                value={`patient-${p.id}-${p.fullName}-${p.phone ?? ""}`}
                onSelect={() => go(`/crm/patients/${p.id}`)}
              >
                <UserIcon className="mr-2 size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{p.fullName}</span>
                {p.phone ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.phone}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results.doctors.length > 0 ? (
          <CommandGroup heading={t("groups.doctors")}>
            {results.doctors.map((d) => (
              <CommandItem
                key={`d-${d.id}`}
                value={`doctor-${d.id}-${doctorName(d)}-${d.specializationRu ?? ""}`}
                onSelect={() => go(`/crm/doctors/${d.id}`)}
              >
                <StethoscopeIcon className="mr-2 size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{doctorName(d)}</span>
                {d.specializationRu ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {d.specializationRu}
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {results.appointments.length > 0 ? (
          <CommandGroup heading={t("groups.appointments")}>
            {results.appointments.map((a) => {
              const primary = a.patient?.fullName ?? t("unknownPatient");
              const secondary = a.doctor
                ? a.doctor.nameRu
                : dateFmt.format(new Date(a.date));
              return (
                <CommandItem
                  key={`a-${a.id}`}
                  value={`appointment-${a.id}-${primary}-${a.status}`}
                  onSelect={() =>
                    go(`/crm/appointments?ap=${encodeURIComponent(a.id)}`)
                  }
                >
                  <CalendarIcon className="mr-2 size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{primary}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {secondary}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {results.conversations.length > 0 ? (
          <CommandGroup heading={t("groups.conversations")}>
            {results.conversations.map((c) => {
              const primary = c.patient?.fullName ?? t("unknownPatient");
              return (
                <CommandItem
                  key={`c-${c.id}`}
                  value={`conv-${c.id}-${primary}-${c.lastMessageText ?? ""}`}
                  onSelect={() =>
                    go(`/crm/telegram?conv=${encodeURIComponent(c.id)}`)
                  }
                >
                  <MessageSquareIcon className="mr-2 size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{primary}</span>
                  {c.lastMessageText ? (
                    <span className="ml-2 max-w-[50%] truncate text-xs text-muted-foreground">
                      {c.lastMessageText}
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
