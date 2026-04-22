/**
 * Unit tests for the tolerant `parseSearchResults` helper used by the
 * global cmdk search dialog. The parser has to survive a range of server
 * responses without exploding, because the real `/api/crm/search` endpoint
 * lives in a different engineer's lane and may evolve independently.
 */
import { describe, expect, it } from "vitest";

import { parseSearchResults } from "@/components/layout/global-search";

describe("parseSearchResults", () => {
  it("returns empty groups for null / undefined / garbage", () => {
    for (const raw of [null, undefined, 42, "oops", [], true]) {
      const out = parseSearchResults(raw);
      expect(out.patients).toEqual([]);
      expect(out.doctors).toEqual([]);
      expect(out.appointments).toEqual([]);
      expect(out.conversations).toEqual([]);
    }
  });

  it("parses valid patient rows and drops malformed ones", () => {
    const out = parseSearchResults({
      patients: [
        { id: "p1", fullName: "Alice", phone: "+998900000001" },
        { id: "p2", fullName: "Bob" },
        { id: "", fullName: "No-ID" },
        { fullName: "Missing ID" },
        { id: "p3" },
        null,
        "nonsense",
      ],
    });
    expect(out.patients).toEqual([
      { id: "p1", fullName: "Alice", phone: "+998900000001" },
      { id: "p2", fullName: "Bob", phone: null },
    ]);
  });

  it("parses doctor rows preserving Uzbek name + specialization", () => {
    const out = parseSearchResults({
      doctors: [
        {
          id: "d1",
          nameRu: "Иванов",
          nameUz: "Ivanov",
          specializationRu: "Невролог",
        },
        { id: "d2", nameRu: "Петров" },
        { id: "d3" }, // dropped: missing nameRu
      ],
    });
    expect(out.doctors).toEqual([
      {
        id: "d1",
        nameRu: "Иванов",
        nameUz: "Ivanov",
        specializationRu: "Невролог",
      },
      {
        id: "d2",
        nameRu: "Петров",
        nameUz: null,
        specializationRu: null,
      },
    ]);
  });

  it("parses appointments, tolerating missing nested patient/doctor", () => {
    const out = parseSearchResults({
      appointments: [
        {
          id: "a1",
          date: "2026-04-22T10:00:00.000Z",
          status: "SCHEDULED",
          patient: { id: "p1", fullName: "Alice", phone: "+998" },
          doctor: { id: "d1", nameRu: "Иванов", nameUz: "Ivanov" },
        },
        {
          id: "a2",
          date: "2026-04-23",
          patient: null,
          doctor: null,
        },
        {
          // dropped: no id
          date: "2026-04-22",
        },
        {
          id: "a3",
          // dropped: no date
        },
      ],
    });
    expect(out.appointments).toHaveLength(2);
    expect(out.appointments[0]).toEqual({
      id: "a1",
      date: "2026-04-22T10:00:00.000Z",
      status: "SCHEDULED",
      patient: { id: "p1", fullName: "Alice", phone: "+998" },
      doctor: { id: "d1", nameRu: "Иванов", nameUz: "Ivanov" },
    });
    expect(out.appointments[1]).toMatchObject({
      id: "a2",
      date: "2026-04-23",
      status: "",
      patient: null,
      doctor: null,
    });
  });

  it("parses conversations with optional last message and patient", () => {
    const out = parseSearchResults({
      conversations: [
        {
          id: "c1",
          channel: "TG",
          status: "ACTIVE",
          lastMessageText: "Здравствуйте",
          patient: { id: "p1", fullName: "Alice" },
        },
        {
          id: "c2",
          channel: "SMS",
          patient: null,
        },
        { channel: "TG" }, // dropped: no id
      ],
    });
    expect(out.conversations).toHaveLength(2);
    expect(out.conversations[0]).toEqual({
      id: "c1",
      channel: "TG",
      status: "ACTIVE",
      lastMessageText: "Здравствуйте",
      patient: { id: "p1", fullName: "Alice" },
    });
    expect(out.conversations[1]).toMatchObject({
      id: "c2",
      channel: "SMS",
      status: "",
      lastMessageText: null,
      patient: null,
    });
  });

  it("treats non-array group fields as empty", () => {
    const out = parseSearchResults({
      patients: "not an array",
      doctors: 123,
      appointments: { not: "array" },
      conversations: null,
    });
    expect(out.patients).toEqual([]);
    expect(out.doctors).toEqual([]);
    expect(out.appointments).toEqual([]);
    expect(out.conversations).toEqual([]);
  });
});
