/**
 * GET  /api/crm/doctors/me/profile — read this doctor's editable profile.
 * PATCH /api/crm/doctors/me/profile — partial update.
 *
 * "Profile" merges fields from two rows: `User` (name, phone, email, photo)
 * and `Doctor` (specialization, bio, pricePerVisit). The doctor only edits
 * their own row — admins use the platform/doctors endpoints to edit anyone.
 *
 * Email + role + clinic are READ-ONLY here. Email is the auth identity and
 * changing it goes through a separate verification flow; role/clinic are
 * admin-only.
 *
 * Audit: DOCTOR_PROFILE_UPDATED on PATCH, with the diff in `meta.changed`.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";

const PatchBody = z
  .object({
    // User-side fields. We split name on the client; the User row stores a
    // single `name` column, so we receive that single string here.
    name: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().max(30).optional().nullable(),
    photoUrl: z.string().url().optional().nullable(),

    // Doctor-side fields. The Doctor row carries RU + UZ for display names —
    // when the doctor edits the russian one we also mirror the latin one to
    // keep the public page consistent. The combobox-y UI on the client only
    // shows the RU variant.
    nameRu: z.string().trim().min(1).max(200).optional(),
    nameUz: z.string().trim().min(1).max(200).optional(),
    specializationRu: z.string().trim().max(200).optional(),
    specializationUz: z.string().trim().max(200).optional(),
    bioRu: z.string().trim().max(5000).optional().nullable(),
    bioUz: z.string().trim().max(5000).optional().nullable(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "empty_patch",
  });

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        photoUrl: true,
        role: true,
        clinicId: true,
        createdAt: true,
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            specializationRu: true,
            specializationUz: true,
            bioRu: true,
            bioUz: true,
            signatureUrl: true,
          },
        },
      },
    });
    if (!user) return err("NotFound", 404);
    if (!user.doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    return ok({
      id: user.id,
      email: user.email,
      role: user.role,
      clinicId: user.clinicId,
      createdAt: user.createdAt.toISOString(),
      name: user.name,
      phone: user.phone,
      photoUrl: user.photoUrl,
      doctorId: user.doctor.id,
      nameRu: user.doctor.nameRu,
      nameUz: user.doctor.nameUz,
      specializationRu: user.doctor.specializationRu,
      specializationUz: user.doctor.specializationUz,
      bioRu: user.doctor.bioRu,
      bioUz: user.doctor.bioUz,
      signatureUrl: user.doctor.signatureUrl,
    });
  },
);

export const PATCH = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const userPatch: Record<string, unknown> = {};
    if (body.name !== undefined) userPatch.name = body.name;
    if (body.phone !== undefined) userPatch.phone = body.phone;
    if (body.photoUrl !== undefined) userPatch.photoUrl = body.photoUrl;

    const doctorPatch: Record<string, unknown> = {};
    if (body.nameRu !== undefined) doctorPatch.nameRu = body.nameRu;
    if (body.nameUz !== undefined) doctorPatch.nameUz = body.nameUz;
    if (body.specializationRu !== undefined) {
      doctorPatch.specializationRu = body.specializationRu;
    }
    if (body.specializationUz !== undefined) {
      doctorPatch.specializationUz = body.specializationUz;
    }
    if (body.bioRu !== undefined) doctorPatch.bioRu = body.bioRu;
    if (body.bioUz !== undefined) doctorPatch.bioUz = body.bioUz;
    // Mirror Doctor.photoUrl to User.photoUrl: the public doctor card pulls
    // from Doctor.photoUrl and the CRM sidebar reads from User.photoUrl.
    if (body.photoUrl !== undefined) doctorPatch.photoUrl = body.photoUrl;

    await prisma.$transaction([
      ...(Object.keys(userPatch).length > 0
        ? [
            prisma.user.update({
              where: { id: ctx.userId },
              data: userPatch,
            }),
          ]
        : []),
      ...(Object.keys(doctorPatch).length > 0
        ? [
            prisma.doctor.update({
              where: { id: doctor.id },
              data: doctorPatch,
            }),
          ]
        : []),
    ]);

    await audit(request, {
      action: AUDIT_ACTION.DOCTOR_PROFILE_UPDATED,
      entityType: "User",
      entityId: ctx.userId,
      meta: { changed: Object.keys(body) },
    });

    return ok({ ok: true });
  },
);
