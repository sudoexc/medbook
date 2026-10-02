/**
 * A5 batch (audit PT-21 to PT-25): the patient card and its documents tell
 * the truth.
 *
 *  - PT-21: a year-only birth date prints as the year, never «01.01.1969».
 *  - PT-22: the Telegram invite dialog recognises the server's 409
 *    `conflict("already_linked")`, whose reason is under `reason`.
 *  - PT-23: case complaint / diagnosis / notes edit in a textarea; Enter is
 *    a new line there, Ctrl/Cmd+Enter saves.
 *  - PT-24: no presence dot, a real status (erased cards say so), no
 *    clickable thing without an action, `?tab=` deep links work.
 *  - PT-25: the card shows «P-00125», not a cuid prefix; the card's
 *    discount is no longer accepted since nothing ever applied it.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/ru/crm/patients",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/[locale]/crm/patients/_hooks/use-patients-stats", () => ({
  usePatientsStats: () => ({ data: undefined, isLoading: true }),
}));

import { formatPrintedBirthDate } from "@/lib/patients/parse-identity";
import { conflict, err } from "@/server/http";
import { CreatePatientSchema, UpdatePatientSchema } from "@/server/schemas/patient";
import { mintResultFromResponse } from "@/app/[locale]/crm/patients/[id]/_components/telegram-invite-result";
import { inlineFieldKeyAction } from "@/app/[locale]/crm/patients/[id]/_components/inline-field";
import { tabFromParam } from "@/app/[locale]/crm/patients/[id]/_components/patient-card-tabs";
import { PatientStatusBadge } from "@/app/[locale]/crm/patients/_components/patient-status-badge";
import { PatientHero } from "@/app/[locale]/crm/patients/[id]/_components/patient-hero";
import { PatientRecommendationsCard } from "@/app/[locale]/crm/patients/[id]/_components/patient-recommendations-card";
import { PatientsRightRail } from "@/app/[locale]/crm/patients/_components/patients-right-rail";
import type { Patient } from "@/app/[locale]/crm/patients/[id]/_hooks/use-patient";
import type { PatientAppointment } from "@/app/[locale]/crm/patients/[id]/_hooks/use-patient-appointments";

const DAY = 86_400_000;

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: "cmf3k2abcdef",
    clinicId: "c1",
    patientNumber: 125,
    fullName: "Турматов Отабек",
    phone: "+998901112233",
    phoneNormalized: "+998901112233",
    phoneVerifiedAt: "2026-09-01T00:00:00.000Z",
    birthDate: "1969-01-01T00:00:00.000Z",
    gender: "MALE",
    passport: null,
    address: null,
    photoUrl: null,
    telegramId: null,
    telegramUsername: null,
    preferredChannel: "TG",
    preferredLang: "RU",
    source: null,
    segment: "ACTIVE",
    tags: [],
    notes: null,
    ltv: 0,
    visitsCount: 2,
    balance: 0,
    discountPct: 0,
    lastVisitAt: null,
    nextVisitAt: null,
    lastContactedAt: null,
    consentMarketing: false,
    deletedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

/** Static markup with the quotes of the mocked `t()` values readable. */
function markup(el: React.ReactElement): string {
  return renderToStaticMarkup(el).replace(/&quot;/g, '"');
}

function render(el: React.ReactElement): string {
  const qc = new QueryClient();
  return markup(
    React.createElement(QueryClientProvider, { client: qc, children: el }),
  );
}

describe("PT-21: a year-only birth date on a printed document", () => {
  it("prints the year alone for 1 January UTC, the date otherwise", () => {
    expect(formatPrintedBirthDate(new Date(Date.UTC(1969, 0, 1)), "ru")).toBe("1969");
    expect(formatPrintedBirthDate("1969-01-01T00:00:00.000Z", "uz")).toBe("1969");
    expect(formatPrintedBirthDate(new Date(Date.UTC(1972, 4, 5)), "ru")).toBe("05.05.1972");
  });
});

describe("PT-22: the invite dialog reads the server's 409", () => {
  it("«already linked» from conflict() is the already-linked branch", async () => {
    const res = conflict("already_linked", {
      telegramId: "777",
      telegramUsername: "otabek",
    });
    expect(mintResultFromResponse(res.status, await res.json())).toEqual({
      kind: "already_linked",
      telegramId: "777",
      telegramUsername: "otabek",
    });
  });

  it("the other answers keep their meaning", async () => {
    const noBot = err("bot_not_configured", 412);
    expect(mintResultFromResponse(noBot.status, await noBot.json())).toEqual({
      kind: "bot_not_configured",
    });
    expect(mintResultFromResponse(500, {})).toEqual({ kind: "error", message: "HTTP 500" });
    const ok = { url: "https://t.me/b?start=x", token: "x", expiresAt: "", botUsername: "b", isFreshlyMinted: true };
    expect(mintResultFromResponse(200, ok)).toEqual({ kind: "ok", data: ok });
  });
});

describe("PT-23: multi-line clinical text keeps its lines", () => {
  it("Enter is a new line in a textarea; Ctrl/Cmd+Enter saves; Esc cancels", () => {
    expect(inlineFieldKeyAction({ key: "Enter" }, true)).toBeNull();
    expect(inlineFieldKeyAction({ key: "Enter", ctrlKey: true }, true)).toBe("save");
    expect(inlineFieldKeyAction({ key: "Enter", metaKey: true }, true)).toBe("save");
    expect(inlineFieldKeyAction({ key: "Escape" }, true)).toBe("cancel");
  });

  it("a one-line field still saves on Enter", () => {
    expect(inlineFieldKeyAction({ key: "Enter" }, false)).toBe("save");
    expect(inlineFieldKeyAction({ key: "a" }, false)).toBeNull();
  });
});

describe("PT-24: the card's status and links", () => {
  it("the status badge is the segment, or «erased» for an anonymised card", () => {
    expect(
      renderToStaticMarkup(React.createElement(PatientStatusBadge, { segment: "DORMANT" })),
    ).toContain("patients.segment.dormant");
    expect(
      renderToStaticMarkup(
        React.createElement(PatientStatusBadge, {
          segment: "ACTIVE",
          deletedAt: "2026-09-20T00:00:00.000Z",
        }),
      ),
    ).toContain("patients.segment.erased");
  });

  it("`?tab=` names a tab, anything else is ignored", () => {
    expect(tabFromParam("communications")).toBe("communications");
    expect(tabFromParam("cases")).toBe("cases");
    expect(tabFromParam("bogus")).toBeNull();
    expect(tabFromParam(null)).toBeNull();
  });

  it("the hero: no «online» dot, the real status, the card number", () => {
    const html = render(
      React.createElement(PatientHero, {
        patient: patient({ segment: "DORMANT" }),
        appointments: [],
        onOpenDeleteDialog: () => {},
        onOpenNewAppointmentDialog: () => {},
      }),
    );
    expect(html).not.toContain("activeBadge");
    expect(html).toContain("patients.segment.dormant");
    expect(html).toContain('patientCard.hero.idLabel{"id":"P-00125"}');
    expect(html).not.toContain("CMF3K2");
    // The presence dot was the online colour on the avatar's corner.
    expect(html).not.toContain("bg-[color:var(--success)]");
    // PT-21 in the hero already held; the year stays a year.
    expect(html).toContain('patientCard.hero.birthYear{"year":1969}');
  });

  it("recommendations: no invented date, and «Показать все» only with more to show", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * DAY).toISOString();
    const html = markup(
      React.createElement(PatientRecommendationsCard, {
        patient: patient({ lastVisitAt: tenDaysAgo }),
        appointments: [],
      }),
    );
    expect(html).toContain('patientCard.recs.rebookDesc{"days":10}');
    expect(html).not.toContain("patientCard.recs.viewAll");

    // Booked ahead: no «Записать на повторный визит»; the Telegram reminder
    // only for a patient who has Telegram.
    const booked = markup(
      React.createElement(PatientRecommendationsCard, {
        patient: patient({
          lastVisitAt: tenDaysAgo,
          nextVisitAt: new Date(Date.now() + 2 * DAY).toISOString(),
        }),
        appointments: [],
      }),
    );
    expect(booked).not.toContain("rebookTitle");
    expect(booked).not.toContain("reminderTitle");

    // Four rules fire: three are shown and the button opens the fourth.
    const completed = Array.from({ length: 3 }, (_, i) => ({
      id: `a${i}`,
      status: "COMPLETED",
    })) as unknown as PatientAppointment[];
    const many = markup(
      React.createElement(PatientRecommendationsCard, {
        patient: patient({
          lastVisitAt: new Date(Date.now() - 90 * DAY).toISOString(),
          nextVisitAt: new Date(Date.now() + 2 * DAY).toISOString(),
          telegramId: "777",
          ltv: 50_000_000,
        }),
        appointments: completed,
      }),
    );
    expect(many).toContain("patientCard.recs.viewAll");
    expect(many).not.toContain("loyaltyTitle");
  });

  it("the list's «Центр действий»: every item leads somewhere, no invented one", () => {
    const html = render(
      React.createElement(PatientsRightRail, {
        rows: [],
        segmentCounts: { VIP: 1, NEW: 2, ACTIVE: 3, DORMANT: 4, CHURN: 5 },
        onSelectSegment: () => {},
      }),
    );
    expect(html).toContain('href="/ru/crm/patients/segments/dormant"');
    expect(html).toContain('href="/ru/crm/patients/segments/new"');
    expect(html).toContain('href="/ru/crm/action-center"');
    expect(html).not.toContain("actions.bookTitle");
    expect(html).not.toContain("cursor-pointer");
  });
});

describe("PT-25: the card's discount is not taken any more", () => {
  it("create and update drop discountPct", () => {
    const created = CreatePatientSchema.parse({
      fullName: "Иванов Иван",
      phone: "+998901234567",
      discountPct: 15,
    });
    expect(created).not.toHaveProperty("discountPct");
    expect(UpdatePatientSchema.parse({ discountPct: 15 })).toEqual({});
  });
});
