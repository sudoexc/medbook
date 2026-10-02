/**
 * Audit VW-26 — the phone correction on the visit screen sent a cleared
 * field as `phone: null`, which the API refuses, and showed the raw
 * «ValidationError»; «123» was accepted although reminders and the Telegram
 * link depend on the number.
 *
 * Pinned:
 *   1. An empty field and a malformed number are refused before sending,
 *      each with its own message; an Uzbek number in any usual spelling and
 *      a full foreign number pass.
 *   2. A refused save is told in words: a number on another card as such,
 *      anything else as the generic failure, never the error code.
 *   3. The messages exist in ru and uz, without dashes.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

import {
  phoneEditProblem,
  phoneSaveErrorKey,
} from "@/app/[locale]/doctor/reception/_components/editable-phone";
import { isValidCardPhone } from "@/lib/phone";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

describe("the number is checked before it is sent", () => {
  it("an empty field is refused, not sent as null", () => {
    expect(phoneEditProblem("")).toBe("phoneRequired");
    expect(phoneEditProblem("   ")).toBe("phoneRequired");
  });

  it.each(["123", "+998 90 123", "90-123-45-6", "0901234567", "+998 12 345 67 89", "abc"])(
    "«%s» is refused as malformed",
    (v) => {
      expect(phoneEditProblem(v)).toBe("phoneInvalid");
    },
  );

  it.each([
    "+998 90 123-45-67",
    "998901234567",
    "901234567",
    "33 412 55 67",
    "+7 916 123 45 67",
    "+996 555 123 456",
  ])("«%s» passes", (v) => {
    expect(phoneEditProblem(v)).toBeNull();
    expect(isValidCardPhone(v)).toBe(true);
  });
});

describe("a refused save is told in words", () => {
  it("a number on another card", () => {
    expect(phoneSaveErrorKey("phone_taken")).toBe("phoneTaken");
    expect(phoneSaveErrorKey("phone_or_telegram_taken")).toBe("phoneTaken");
  });

  it("anything else is the generic failure", () => {
    expect(phoneSaveErrorKey(null)).toBe("phoneSaveFailed");
    expect(phoneSaveErrorKey("ValidationError")).toBe("phoneSaveFailed");
  });
});

describe("the messages", () => {
  for (const [lang, m] of [
    ["ru", ru],
    ["uz", uz],
  ] as const) {
    it(`${lang}: present, no dashes`, () => {
      const a = (m as { doctor: { reception: { activePatient: Record<string, string> } } })
        .doctor.reception.activePatient;
      for (const k of ["phoneRequired", "phoneInvalid", "phoneTaken", "phoneSaveFailed"]) {
        expect(a[k], k).toBeTruthy();
        expect(a[k]).not.toMatch(/[—–]/);
      }
    });
  }
});
