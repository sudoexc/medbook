/**
 * P1.2 — patient-facing lab results (Mini App).
 *
 *   GET /api/miniapp/labs?clinicSlug=…
 *
 * Returns the active patient's `LabResult` rows that the ordering doctor has
 * already **REVIEWED**. The `status = REVIEWED` filter is the clinical-safety
 * gate: a raw PENDING/RESULTED row may carry a frightening HIGH/CRITICAL flag
 * that the doctor hasn't yet put in context ("это ожидаемо после нагрузки"),
 * so the patient must never see it before review — exactly mirroring the
 * "only finalized conclusions reach the patient" rule from P1.1.
 *
 * We expose only the fields the patient needs to read the result
 * (`testName, value, unit, refRange, flag, reviewedAt, doctorName,
 * attachmentUrl`). The internal `LabResult.notes` is the doctor's private
 * annotation and is deliberately NOT selected — same boundary as never
 * shipping a visit note's clinical `bodyMarkdown`.
 *
 * Scope: `clinicId + patientId` from the resolved Mini App context. Unlike
 * `/medications` there is no `onBehalfOf` family branch — a lab result is a
 * single-owner clinical record, identical to `/documents`.
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const rows = await prisma.labResult.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      status: "REVIEWED",
    },
    // Most-recently-reviewed first; `receivedAt` (always stamped) breaks ties
    // for the theoretical REVIEWED-without-reviewedAt row.
    orderBy: [{ reviewedAt: "desc" }, { receivedAt: "desc" }],
    take: 100,
    select: {
      id: true,
      testName: true,
      value: true,
      unit: true,
      refRange: true,
      flag: true,
      reviewedAt: true,
      attachmentUrl: true,
      // `LabResult.doctor` is the ordering `User` (single `name`); the
      // localized nameRu/nameUz live on the linked `Doctor` profile, so we hop
      // one level further and fall back to `User.name` for the rare staff user
      // without a doctor profile.
      doctor: {
        select: {
          name: true,
          doctor: { select: { nameRu: true, nameUz: true } },
        },
      },
    },
  });

  const lang = ctx.patient.preferredLang;
  const labs = rows.map((r) => {
    const profile = r.doctor.doctor;
    const doctorName = profile
      ? lang === "UZ"
        ? profile.nameUz
        : profile.nameRu
      : r.doctor.name;
    return {
      id: r.id,
      testName: r.testName,
      value: r.value,
      unit: r.unit,
      refRange: r.refRange,
      flag: r.flag,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      doctorName,
      // Reserved column — no upload UI ships yet, so this is null for every
      // current row. Surfaced for forward-compat; the screen only renders an
      // attachment affordance once a serving route exists.
      attachmentUrl: r.attachmentUrl,
    };
  });

  return ok({ labs });
});
