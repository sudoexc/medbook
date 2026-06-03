/**
 * Phase 16 Wave 1 — Family accounts (Mini App).
 *
 * GET  /api/miniapp/family?clinicSlug=…
 *   Returns `{ self, members }` where:
 *     - `self` is the TG-linked patient (the "owner")
 *     - `members` is the array of `PatientFamily` rows the owner controls
 *
 * POST /api/miniapp/family
 *   Body: { fullName, phone?, birthDate?, gender?, relationship }
 *   Creates a new Patient + PatientFamily link in one transaction.
 *   "Claim" path: if a Patient with the same fullName + phoneNormalized
 *   already exists in this clinic AND isn't already linked, reuse that row
 *   instead of creating a duplicate.
 *
 * The DELETE handler lives at `family/[linkedPatientId]/route.ts`.
 *
 * Authn: Mini App init-data → `ctx.patientId` is the owner. There is no
 * PATIENT role — every query MUST manually scope to `ctx.clinicId` (the
 * Mini App handler runs as SYSTEM tenant context).
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { err, ok } from "@/server/http";
import { allocatePatientNumber } from "@/server/services/patient-number";
import {
  createMiniAppHandler,
  createMiniAppListHandler,
} from "@/server/miniapp/handler";
import {
  AddFamilyMemberSchema,
  MAX_FAMILY_LINKS,
  validateFamilyAddition,
} from "@/server/services/family";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const [self, links] = await Promise.all([
    prisma.patient.findFirst({
      where: { id: ctx.patientId, clinicId: ctx.clinicId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        birthDate: true,
        gender: true,
      },
    }),
    prisma.patientFamily.findMany({
      where: { ownerPatientId: ctx.patientId, clinicId: ctx.clinicId },
      orderBy: { createdAt: "asc" },
      include: {
        linkedPatient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            birthDate: true,
            gender: true,
          },
        },
      },
    }),
  ]);
  if (!self) return err("not_found", 404);
  return ok({
    self,
    members: links.map((l) => ({
      linkId: l.id,
      relationship: l.relationship,
      patient: l.linkedPatient,
      createdAt: l.createdAt,
    })),
    max: MAX_FAMILY_LINKS,
  });
});

const PostBody = AddFamilyMemberSchema;

export const POST = createMiniAppHandler(
  { bodySchema: PostBody },
  async ({ request, body, ctx }) => {
    // Phone normalisation: optional. Empty string + null both mean "no phone".
    const rawPhone = body.phone?.trim() ?? "";
    const normalizedPhone = rawPhone ? normalizePhone(rawPhone) : "";

    // birthDate accepts "YYYY-MM-DD" or full ISO; coerce to Date | null.
    let birthDate: Date | null = null;
    if (body.birthDate) {
      const parsed = new Date(body.birthDate);
      if (!Number.isNaN(parsed.getTime())) birthDate = parsed;
    }

    // Existing-link count — used by validator for the MAX cap and the
    // duplicate check.
    const existingLinks = await prisma.patientFamily.findMany({
      where: { ownerPatientId: ctx.patientId, clinicId: ctx.clinicId },
      select: { linkedPatientId: true },
    });
    const linkedSet = new Set(existingLinks.map((l) => l.linkedPatientId));

    // Claim path: try to find an existing patient row matching fullName +
    // phoneNormalized inside the same clinic. If found AND not already
    // linked, we reuse it instead of inserting a duplicate.
    let claimCandidateId: string | null = null;
    if (normalizedPhone) {
      const match = await prisma.patient.findFirst({
        where: {
          clinicId: ctx.clinicId,
          phoneNormalized: normalizedPhone,
          fullName: body.fullName.trim(),
        },
        select: { id: true },
      });
      if (match) claimCandidateId = match.id;
    }

    const validation = validateFamilyAddition({
      ownerPatientId: ctx.patientId,
      candidateLinkedPatientId: claimCandidateId,
      relationship: body.relationship,
      existingLinkCount: existingLinks.length,
      alreadyLinkedPatientIds: linkedSet,
    });
    if (validation) {
      switch (validation.kind) {
        case "self_link":
          return err("self_link", 400);
        case "max_reached":
          return err("max_reached", 400, { max: validation.max });
        case "duplicate":
          return err("duplicate", 400);
        case "invalid_relationship":
          return err("invalid_relationship", 400);
      }
    }

    // Transaction: ensure patient + link land atomically.
    const result = await prisma.$transaction(async (tx) => {
      let linkedPatientId: string;
      let createdNew = false;

      if (claimCandidateId) {
        linkedPatientId = claimCandidateId;
      } else {
        // Phone uniqueness inside a clinic: Patient has @@unique([clinicId,
        // phoneNormalized]). For relatives without a phone, store an empty
        // phone but keep `phoneNormalized` distinct so we don't collide
        // with other phone-less relatives. Trick: prefix with `family:` +
        // a short random tag.
        const stubNormalized = normalizedPhone
          ? normalizedPhone
          : `family:${ctx.patientId}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const patientNumber = await allocatePatientNumber(ctx.clinicId, tx);
        const created = await tx.patient.create({
          data: {
            clinicId: ctx.clinicId,
            patientNumber,
            fullName: body.fullName.trim(),
            phone: rawPhone,
            phoneNormalized: stubNormalized,
            birthDate,
            gender: body.gender ?? undefined,
            preferredLang: ctx.patient.preferredLang,
            // No telegramId for the relative — only the owner has the TG link.
            source: "TELEGRAM",
          },
          select: { id: true, fullName: true, phone: true, birthDate: true, gender: true },
        });
        linkedPatientId = created.id;
        createdNew = true;
      }

      const link = await tx.patientFamily.create({
        data: {
          clinicId: ctx.clinicId,
          ownerPatientId: ctx.patientId,
          linkedPatientId,
          relationship: body.relationship,
        },
        include: {
          linkedPatient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              birthDate: true,
              gender: true,
            },
          },
        },
      });

      // Phase M2 — `patient.familyLinked` envelope. Audited via EVENT_META
      // (outbox pumper materialises the AuditLog row); no manual audit() call.
      const envelope: EventEnvelopeInput = {
        correlationId: newCorrelationId(),
        actor: {
          role: "PATIENT",
          userId: null,
          patientId: ctx.patientId,
          onBehalfOfPatientId: null,
          label: `patient:${ctx.patientId}`,
        },
        surface: "MINIAPP",
        tenantScope: {
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
        },
        type: "patient.familyLinked",
        payload: {
          ownerPatientId: ctx.patientId,
          linkedPatientId,
          relationship: body.relationship,
          createdNew,
        },
      };
      await publishViaOutbox(tx, envelope);

      return { link, createdNew };
    });

    return ok(
      {
        member: {
          linkId: result.link.id,
          relationship: result.link.relationship,
          patient: result.link.linkedPatient,
          createdAt: result.link.createdAt,
        },
        createdNew: result.createdNew,
      },
      201,
    );
  },
);

// Re-export shared types for the client hook.
export type FamilyAddBody = z.infer<typeof PostBody>;
