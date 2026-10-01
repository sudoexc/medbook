/**
 * /api/crm/calls/[id] — get, patch (summary/tags/link patient/appt).
 * See docs/TZ.md §6.4.
 *
 * Ending a call is `POST .../end` (audit CM-07); this PATCH only edits the
 * notes, tags and links, each link checked against the clinic (audit CM-09).
 *
 * Phase 9d — gated behind `flags.hasCallCenter` (404 on basic-tier).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { CALL_CENTER_ROLES } from "@/lib/calls/roles";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff, err } from "@/server/http";
import { UpdateCallSchema } from "@/server/schemas/call";
import { ensureFeature } from "@/server/platform/feature-guard";
import { checkCallRefs } from "@/server/telephony/call-refs";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: [...CALL_CENTER_ROLES] },
  async ({ request, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    const id = idFromUrl(request);
    const row = await prisma.call.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, segment: true } },
        operator: { select: { id: true, name: true } },
      },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  { roles: [...CALL_CENTER_ROLES], bodySchema: UpdateCallSchema },
  async ({ request, body, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);
    const before = await prisma.call.findUnique({ where: { id } });
    if (!before) return notFound();
    const problem = await checkCallRefs(
      prisma,
      ctx.clinicId,
      body,
      // The appointment must be the patient's the call stays linked to.
      body.patientId !== undefined ? body.patientId : before.patientId,
    );
    if (problem) return err("InvalidReference", 400, { reason: problem });
    const after = await prisma.call.update({
      where: { id },
      data: {
        ...(body.operatorId !== undefined ? { operatorId: body.operatorId } : {}),
        ...(body.patientId !== undefined ? { patientId: body.patientId } : {}),
        ...(body.appointmentId !== undefined
          ? { appointmentId: body.appointmentId }
          : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, segment: true } },
        operator: { select: { id: true, name: true } },
      },
    });
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "call.update",
      entityType: "Call",
      entityId: id,
      meta: d,
    });
    return ok(after);
  }
);
