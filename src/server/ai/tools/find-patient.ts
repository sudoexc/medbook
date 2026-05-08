/**
 * Phase 15 Wave 3 — `findPatient` tool.
 *
 * READ-ONLY. Looks up patients by name OR phone substring. Returns up to 5
 * matches, each with a `/crm/patients/{id}` deeplink the user can click.
 *
 * The LLM is told only `summary` ("Found N matches; the most likely is X");
 * the structured `data` and `chips` are returned to the UI separately so the
 * deeplinks live entirely outside the prompt window — keeps the model from
 * accidentally pasting an internal URL into the answer.
 */

import { prisma } from "@/lib/prisma";
import type { Tool, ToolContext, ToolResult } from "./types";

type FindPatientInput = {
  query: string;
};

const MAX_RESULTS = 5;

function normalizePhone(q: string): string | null {
  const digits = q.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return digits;
}

export const findPatientTool: Tool<FindPatientInput> = {
  name: "findPatient",
  description:
    "Find patients by full name or phone number (partial match supported). Use when the user asks 'find Karimov' or types a phone number. Returns up to 5 matches.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search query — patient name fragment, full name, or phone number (with or without country code).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (
    input: FindPatientInput,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const q = (input.query ?? "").trim();
    if (q.length < 2) {
      return {
        ok: false,
        data: null,
        summary:
          context.locale === "ru"
            ? "Запрос слишком короткий — нужно минимум 2 символа."
            : "So'rov juda qisqa — kamida 2 ta belgi kerak.",
      };
    }

    const phoneDigits = normalizePhone(q);
    const orClauses: Array<Record<string, unknown>> = [
      { fullName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
    ];
    if (phoneDigits) {
      orClauses.push({ phoneNormalized: { contains: phoneDigits } });
    }

    const rows = await prisma.patient.findMany({
      where: {
        clinicId: context.clinicId,
        OR: orClauses,
      },
      select: {
        id: true,
        fullName: true,
        phone: true,
        lastVisitAt: true,
      },
      orderBy: [{ lastVisitAt: "desc" }, { createdAt: "desc" }],
      take: MAX_RESULTS,
    });

    const data = rows.map((p) => ({
      patientId: p.id,
      fullName: p.fullName,
      phone: p.phone,
      lastVisitAt: p.lastVisitAt ? p.lastVisitAt.toISOString() : null,
      deeplink: `/crm/patients/${p.id}`,
    }));

    const summary =
      data.length === 0
        ? context.locale === "ru"
          ? `Пациенты по запросу «${q}» не найдены.`
          : `«${q}» bo'yicha bemorlar topilmadi.`
        : context.locale === "ru"
          ? `Найдено ${data.length} пациент${data.length === 1 ? "" : data.length < 5 ? "а" : "ов"}. Первый: ${data[0]!.fullName}.`
          : `${data.length} ta bemor topildi. Birinchisi: ${data[0]!.fullName}.`;

    return {
      ok: true,
      data: { patients: data },
      summary,
      chips: data.map((p) => ({
        kind: "patient" as const,
        label: p.fullName,
        deeplink: p.deeplink,
      })),
    };
  },
};
