/**
 * /api/crm/doctor-arsenal — «Мой арсенал» (owner request 03.10.2026: every
 * doctor's constant set of drugs and diagnoses, worked with the mouse).
 *
 *   GET    ?kind=DRUG|ICD10[&doctorId=]  his arsenal in order (drugs with
 *          their schema), his top 30 («Ваши частые», the source of «В
 *          арсенал»), the clinic's core list in clinic-wide use order
 *          (drugs), and his «10 · 20 · 30» choice.
 *   POST   { kind, code, schema?, doctorId? }    pin at the end (30 at most)
 *   DELETE { kind, code, doctorId? }             unpin
 *   PATCH  { op: "reorder", kind, codes, doctorId? }   drag to reorder
 *          { op: "schema", code, schema, doctorId? }   a drug's usual schema
 *          { op: "limit", kind, limit, doctorId? }     10, 20 or 30 «Частые»
 *
 * The pins are DoctorFavorite rows, the very stars of the visit screen:
 * the arsenal is «Мои», the page only manages it. Without `doctorId` the
 * caller's own card; with it, a doctor of the caller's clinic, for the
 * clinic's ADMIN (resolveArsenalDoctor: a DOCTOR may name only himself).
 * Every change is audited with the doctor it was made for.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import {
  ARSENAL_MAX,
  ARSENAL_PINS_READ,
  nextArsenalPosition,
  orderArsenal,
  parseDrugArsenalSchema,
  reorderedWindow,
  SCHEMA_LIMITS,
  type ArsenalKind,
} from "@/lib/arsenal";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { resolveArsenalDoctor, type ArsenalDoctor } from "@/server/arsenal/target";
import {
  loadDoctorDiagnosisLists,
  loadDoctorDrugLists,
} from "@/server/catalog/doctor-lists";
import { loadDrugHits } from "@/server/catalog/drug-hits";
import { loadFormulary } from "@/server/catalog/formulary";
import {
  isPinnableDiagnosisCode,
  pinnableDiagnosisCodes,
} from "@/server/icd10/clinic-catalog";
import { err, ok, parseQuery } from "@/server/http";

const ROLES = ["ADMIN", "DOCTOR"] as const;
const KIND = z.enum(["DRUG", "ICD10"]);
const DoctorIdField = z.string().trim().min(1).max(64).optional();
const CodeField = z.string().trim().min(1).max(120);

/** A drug schema as the page sends it; `parseDrugArsenalSchema` then cleans it. */
const SchemaInput = z
  .object({
    form: z.string().max(SCHEMA_LIMITS.form).nullable().optional(),
    strength: z.string().max(SCHEMA_LIMITS.strength).nullable().optional(),
    dose: z.string().max(SCHEMA_LIMITS.dose).nullable().optional(),
    timesOfDay: z.array(z.enum(["MORNING", "NOON", "EVENING", "NIGHT"])).max(4).optional(),
    mealRelation: z
      .enum(["BEFORE_MEAL", "WITH_MEAL", "AFTER_MEAL", "EMPTY_STOMACH", "NO_MATTER"])
      .nullable()
      .optional(),
    durationDays: z.number().int().min(1).max(SCHEMA_LIMITS.maxDays).nullable().optional(),
    instructionRu: z.string().max(SCHEMA_LIMITS.instruction).nullable().optional(),
    instructionUz: z.string().max(SCHEMA_LIMITS.instruction).nullable().optional(),
  })
  .strict();

const QuerySchema = z.object({ kind: KIND, doctorId: DoctorIdField });

const AddBody = z.object({
  doctorId: DoctorIdField,
  kind: KIND,
  code: CodeField,
  schema: SchemaInput.nullable().optional(),
});

const RemoveBody = z.object({
  doctorId: DoctorIdField,
  kind: KIND,
  code: CodeField,
});

const PatchBody = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("reorder"),
    doctorId: DoctorIdField,
    kind: KIND,
    // The pins the page shows, never more (`ARSENAL_PINS_READ`).
    codes: z.array(CodeField).max(ARSENAL_PINS_READ),
  }),
  z.object({
    op: z.literal("schema"),
    doctorId: DoctorIdField,
    code: CodeField,
    schema: SchemaInput.nullable(),
  }),
  z.object({
    op: z.literal("limit"),
    doctorId: DoctorIdField,
    kind: KIND,
    limit: z.union([z.literal(10), z.literal(20), z.literal(30)]),
  }),
]);

/**
 * ICD codes are stored as the visit screen's star stores them, upper case,
 * and compared case-insensitively: an older pin written another way is
 * still that code, found, moved and removed like the others.
 */
function storedCode(kind: ArsenalKind, code: string): string {
  return kind === "ICD10" ? code.trim().toUpperCase() : code.trim();
}

function doctorName(d: ArsenalDoctor) {
  return { id: d.id, nameRu: d.nameRu, nameUz: d.nameUz };
}

async function pinsOf(userId: string, kind: ArsenalKind) {
  const rows = await prisma.doctorFavorite.findMany({
    where: { userId, entityType: kind },
    select: { id: true, entityCode: true, sortOrder: true, createdAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 200,
  });
  return orderArsenal(rows);
}

// ── GET ────────────────────────────────────────────────────────────────

export const GET = createApiListHandler({ roles: [...ROLES] }, async ({ request, ctx }) => {
  if (ctx.kind !== "TENANT") return err("Forbidden", 403);
  const parsed = parseQuery(request, QuerySchema);
  if (!parsed.ok) return parsed.response;
  const target = await resolveArsenalDoctor(ctx, parsed.value.doctorId);
  if (!target.ok) return target.response;
  const doctor = target.doctor;

  if (parsed.value.kind === "DRUG") {
    const lists = await loadDoctorDrugLists({
      doctor,
      clinicId: ctx.clinicId,
      days: 365,
      limit: 12,
    });
    const pinned = new Set(lists.arsenal.map((p) => p.code));
    const coreById = new Map(lists.core.map((c) => [c.drugId, c]));
    return ok({
      doctor: doctorName(doctor),
      kind: "DRUG",
      max: ARSENAL_MAX,
      frequentLimit: lists.frequentLimit,
      items: lists.arsenal,
      top: lists.topCatalog.filter((e) => e.drugId && !pinned.has(e.drugId)),
      core: lists.coreRank
        .map((id) => coreById.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c && !pinned.has(c.drugId!)),
    });
  }

  const lists = await loadDoctorDiagnosisLists({ doctor, days: 365, limit: 12 });
  const pinned = new Set(lists.arsenal.map((p) => p.code));
  // «В арсенал» only for what a pin would accept (POST checks the same):
  // a code from an old note that neither catalog knows is not offered.
  const pinnable = await pinnableDiagnosisCodes(
    lists.frequent.map((d) => d.code ?? "").filter(Boolean),
  );
  return ok({
    doctor: doctorName(doctor),
    kind: "ICD10",
    max: ARSENAL_MAX,
    frequentLimit: lists.frequentLimit,
    items: lists.arsenal,
    // Only coded diagnoses can be pinned: a pin is a code.
    top: lists.frequent.filter(
      (d) => d.code && !pinned.has(d.code.toUpperCase()) && pinnable.has(d.code.toUpperCase()),
    ),
    topSource: lists.frequentSource,
  });
});

// ── POST: pin at the end ───────────────────────────────────────────────

export const POST = createApiHandler(
  { roles: [...ROLES], bodySchema: AddBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const target = await resolveArsenalDoctor(ctx, body.doctorId);
    if (!target.ok) return target.response;
    const { doctor } = target;
    const code = storedCode(body.kind, body.code);

    if (body.kind === "DRUG") {
      // Only a drug this clinic can prescribe: a pin nobody can add from
      // «Мои» would sit in his 30 as a dead slot.
      const formulary = await loadFormulary();
      const hits = await loadDrugHits([code], ctx.clinicId, formulary);
      if (!hits.has(code)) return err("NotFound", 404, { reason: "drug_not_visible" });
    } else if (!(await isPinnableDiagnosisCode(code))) {
      // A code of the classifier or of the clinic's own catalog only: a
      // typo would sit in his 30 as a nameless slot.
      return err("NotFound", 404, { reason: "diagnosis_unknown" });
    }

    const pins = await pinsOf(doctor.userId, body.kind);
    const existing = pins.find((p) => storedCode(body.kind, p.entityCode) === code);
    if (existing) return ok({ created: false, code });
    if (pins.length >= ARSENAL_MAX) {
      return err("ArsenalFull", 409, { reason: "arsenal_full", max: ARSENAL_MAX });
    }

    const schema = body.kind === "DRUG" ? parseDrugArsenalSchema(body.schema) : null;
    let created;
    try {
      created = await prisma.doctorFavorite.create({
        data: {
          userId: doctor.userId,
          entityType: body.kind,
          entityCode: code,
          sortOrder: nextArsenalPosition(pins),
          ...(schema ? { schema } : {}),
        },
        select: { id: true },
      });
    } catch (e) {
      // The same pin from a second tab or a star a moment ago: done already.
      if ((e as { code?: string })?.code === "P2002") return ok({ created: false, code });
      throw e;
    }

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_FAVORITE_ADDED,
      entityType: "DoctorFavorite",
      entityId: created.id,
      meta: {
        userId: doctor.userId,
        doctorId: doctor.id,
        targetEntityType: body.kind,
        entityCode: code,
        via: "arsenal",
      },
    });
    return ok({ created: true, code });
  },
);

// ── DELETE: unpin ──────────────────────────────────────────────────────

export const DELETE = createApiHandler(
  { roles: [...ROLES], bodySchema: RemoveBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const target = await resolveArsenalDoctor(ctx, body.doctorId);
    if (!target.ok) return target.response;
    const { doctor } = target;
    const code = storedCode(body.kind, body.code);

    const existing = (await pinsOf(doctor.userId, body.kind)).find(
      (p) => storedCode(body.kind, p.entityCode) === code,
    );
    if (!existing) return ok({ removed: false });
    await prisma.doctorFavorite.delete({ where: { id: existing.id } });

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_FAVORITE_REMOVED,
      entityType: "DoctorFavorite",
      entityId: existing.id,
      meta: {
        userId: doctor.userId,
        doctorId: doctor.id,
        targetEntityType: body.kind,
        entityCode: code,
        via: "arsenal",
      },
    });
    return ok({ removed: true });
  },
);

// ── PATCH: reorder, schema, limit ──────────────────────────────────────

export const PATCH = createApiHandler(
  { roles: [...ROLES], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const target = await resolveArsenalDoctor(ctx, body.doctorId);
    if (!target.ok) return target.response;
    const { doctor } = target;

    if (body.op === "reorder") {
      const codes = body.codes.map((c) => storedCode(body.kind, c));
      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.doctorFavorite.findMany({
          where: { userId: doctor.userId, entityType: body.kind },
          select: { id: true, entityCode: true, sortOrder: true, createdAt: true },
          // In arsenal order, so the window below is the page's window.
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          take: 200,
        });
        const ordered = orderArsenal(rows);
        const rowOf = new Map(ordered.map((r) => [storedCode(body.kind, r.entityCode), r]));
        const codesOf = (list: typeof ordered) => [
          ...new Set(list.map((r) => storedCode(body.kind, r.entityCode))),
        ];
        // The page shows the first ARSENAL_PINS_READ pins: the drag is the
        // order of those, and any older stars past them stay after them.
        const shown = codesOf(ordered.slice(0, ARSENAL_PINS_READ));
        const past = codesOf(ordered.slice(ARSENAL_PINS_READ)).filter((c) => !shown.includes(c));
        const plan = reorderedWindow([...shown, ...past], codes, shown.length);
        if (!plan.ok) return { ok: false as const, current: shown };
        for (const p of plan.positions) {
          const row = rowOf.get(p.entityCode)!;
          if (row.sortOrder === p.sortOrder) continue;
          await tx.doctorFavorite.update({
            where: { id: row.id },
            data: { sortOrder: p.sortOrder },
          });
        }
        return { ok: true as const, current: codes };
      });
      if (!result.ok) {
        // The list changed under the drag (a star on the visit screen, a
        // second tab): the page reloads it rather than saving an order
        // nobody looked at.
        return err("OrderStale", 409, { reason: "order_stale", codes: result.current });
      }
      await audit(request, {
        action: AUDIT_ACTION.DOCTOR_ARSENAL_REORDERED,
        entityType: "Doctor",
        entityId: doctor.id,
        meta: { userId: doctor.userId, targetEntityType: body.kind, codes },
      });
      return ok({ codes });
    }

    if (body.op === "schema") {
      const code = storedCode("DRUG", body.code);
      const existing = await prisma.doctorFavorite.findUnique({
        where: {
          userId_entityType_entityCode: {
            userId: doctor.userId,
            entityType: "DRUG",
            entityCode: code,
          },
        },
        select: { id: true },
      });
      if (!existing) return err("NotFound", 404, { reason: "not_in_arsenal" });
      const schema = parseDrugArsenalSchema(body.schema);
      await prisma.doctorFavorite.update({
        where: { id: existing.id },
        // Json column: «no schema» is a database NULL, not JSON null.
        data: { schema: schema ?? Prisma.DbNull },
      });
      await audit(request, {
        action: AUDIT_ACTION.DOCTOR_ARSENAL_SCHEMA_SET,
        entityType: "Doctor",
        entityId: doctor.id,
        meta: { userId: doctor.userId, entityCode: code, schema },
      });
      return ok({ code, schema });
    }

    await prisma.doctor.update({
      where: { id: doctor.id },
      data:
        body.kind === "DRUG"
          ? { frequentDrugLimit: body.limit }
          : { frequentDiagnosisLimit: body.limit },
      select: { id: true },
    });
    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_FREQUENT_LIMIT_SET,
      entityType: "Doctor",
      entityId: doctor.id,
      meta: { targetEntityType: body.kind, limit: body.limit },
    });
    return ok({ kind: body.kind, limit: body.limit });
  },
);
