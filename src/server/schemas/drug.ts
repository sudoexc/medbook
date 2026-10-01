import { z } from "zod";

import { queryBool } from "./query-bool";

export const QueryDrugSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  /** ATC prefix filter, e.g. "C09" matches ACE inhibitors + ARBs. */
  atc: z.string().optional(),
  /** Filter by ICD-10 prefix — used by the diagnosis-driven suggestion engine. */
  indication: z.string().optional(),
  /**
   * Ф2 — full ICD-10 code (e.g. "G43.0"); matches drugs whose `indications`
   * contain ANY prefix of it ("G43.0" hits both "G43" and "G43.0").
   */
  forDiagnosis: z.string().max(10).optional(),
  active: queryBool(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Paging offset — the reference browser walks the whole catalog with it. */
  offset: z.coerce.number().int().min(0).default(0),
  /** Prescription-only filter: true = Rx, false = OTC, absent = both. */
  rxOnly: queryBool(),
  /** Only drugs carrying curated dosing copy (our 265-strong core). */
  withDosing: queryBool(),
  /** Explicit id list — how the browser resolves a doctor's favourites. */
  ids: z.string().max(4000).optional(),
  /** Only rows still missing a packaging photo — the fill-in worklist. */
  noPhoto: queryBool(),
});
