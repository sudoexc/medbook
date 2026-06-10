/**
 * Ф4 (TZ-smart-constructor) — clinic-local knowledge-base rows
 * (/api/crm/knowledge/*). Global seed rows are never edited through these
 * schemas — clinics patch globals via ClinicCatalogOverlay.overridesJson.
 */
import { z } from "zod";

export const DRUG_CATEGORIES = [
  "ANTIBIOTIC",
  "ANALGESIC",
  "ANTIPYRETIC",
  "NSAID",
  "ANTIHISTAMINE",
  "GI",
  "CARDIO",
  "RESPIRATORY",
  "VITAMIN",
  "SEDATIVE",
  "ENDOCRINE",
  "DIURETIC",
  "ANTIEMETIC",
  "ANTISPASMODIC",
  "STEROID",
  "TOPICAL",
  "EYE_EAR",
  "UROLOGY",
  "NEUROLOGICAL",
  "PSYCHIATRIC",
  "ANTIFUNGAL",
  "ANTIVIRAL",
  "HORMONAL",
  "DERMATOLOGICAL",
  "HEMATOLOGY",
  "OPHTHALMIC",
  "GYNECOLOGY",
  "VACCINE",
  "OTHER",
] as const;

const ShortLine = z.string().trim().min(1).max(300);
const TextList = z.array(z.string().trim().min(1).max(500)).max(40);
const IcdPrefixList = z
  .array(z.string().trim().min(1).max(10))
  .max(20)
  .default([]);

/** Mirrors Drug.forms JSON: [{ form: "TAB", strengths: ["5 мг"] }]. */
const DrugFormsSchema = z
  .array(
    z.object({
      form: z.string().trim().min(1).max(40),
      strengths: z.array(z.string().trim().min(1).max(60)).max(12).default([]),
    }),
  )
  .max(8)
  .default([]);

/** Mirrors Drug.defaultDosing JSON: { adult?, pediatric?, renal? }. */
const DefaultDosingSchema = z
  .object({
    adult: z.string().trim().max(1_000).optional(),
    pediatric: z.string().trim().max(1_000).optional(),
    renal: z.string().trim().max(1_000).optional(),
  })
  .nullable()
  .optional();

export const CreateClinicDrugSchema = z.object({
  inn: z.string().trim().min(2).max(200),
  nameRu: ShortLine,
  nameUz: z.string().trim().max(300).nullable().optional(),
  category: z.enum(DRUG_CATEGORIES),
  atcCode: z.string().trim().max(10).nullable().optional(),
  forms: DrugFormsSchema,
  indications: IcdPrefixList,
  contraindications: TextList.default([]),
  sideEffects: TextList.default([]),
  defaultDosing: DefaultDosingSchema,
  rxOnly: z.boolean().default(true),
});

export type CreateClinicDrugInput = z.infer<typeof CreateClinicDrugSchema>;

export const UpdateClinicDrugSchema = CreateClinicDrugSchema.partial().extend({
  active: z.boolean().optional(),
});

export type UpdateClinicDrugInput = z.infer<typeof UpdateClinicDrugSchema>;

const GuideBlock = z.string().trim().max(8_000).nullable().optional();

export const CreateClinicGuideSchema = z.object({
  matchPrefix: z.string().trim().min(1).max(20),
  titleRu: ShortLine,
  titleUz: z.string().trim().max(300).nullable().optional(),
  whatToDoRu: GuideBlock,
  whatToDoUz: GuideBlock,
  careRu: GuideBlock,
  careUz: GuideBlock,
  lifestyleRu: GuideBlock,
  lifestyleUz: GuideBlock,
  redFlagsRu: GuideBlock,
  redFlagsUz: GuideBlock,
  adviceChips: TextList.default([]),
  defaultFollowUpDays: z.number().int().min(1).max(365).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9_999).optional(),
});

export type CreateClinicGuideInput = z.infer<typeof CreateClinicGuideSchema>;

export const UpdateClinicGuideSchema = CreateClinicGuideSchema.partial().extend(
  {
    active: z.boolean().optional(),
  },
);

export type UpdateClinicGuideInput = z.infer<typeof UpdateClinicGuideSchema>;

export const CreateClinicHandoutSchema = z.object({
  titleRu: ShortLine,
  titleUz: z.string().trim().max(300).nullable().optional(),
  summaryRu: z.string().trim().max(500).nullable().optional(),
  bodyMd: z.string().trim().min(1).max(64_000),
  bodyMdUz: z.string().trim().max(64_000).nullable().optional(),
  matchPrefixes: IcdPrefixList,
  topic: z.string().trim().max(120).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9_999).optional(),
});

export type CreateClinicHandoutInput = z.infer<
  typeof CreateClinicHandoutSchema
>;

export const UpdateClinicHandoutSchema =
  CreateClinicHandoutSchema.partial().extend({
    active: z.boolean().optional(),
  });

export type UpdateClinicHandoutInput = z.infer<
  typeof UpdateClinicHandoutSchema
>;
