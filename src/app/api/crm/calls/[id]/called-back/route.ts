/**
 * POST /api/crm/calls/[id]/called-back — «Перезвонили» on a missed call
 * (audit CM-13).
 *
 * The sidebar and topbar counted today's missed calls, yet no screen listed
 * them, so nobody could call back from the badge. The call center now lists
 * them («Пропущенные»), and this marks one handled: the `called_back` tag
 * takes it out of the badge and the «ждут перезвона» part of the list
 * (`pendingMissedCallsWhere`). Idempotent; only a missed call can be marked.
 * The patient is not stamped as contacted: a call back may reach nobody,
 * and `lastContactedAt` drives the «не на связи» risk signal.
 */
import { createApiHandler } from "@/lib/api-handler";
import { CALL_CENTER_ROLES } from "@/lib/calls/roles";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { conflict, err, notFound, ok } from "@/server/http";
import { ensureFeature } from "@/server/platform/feature-guard";
import { publishEventSafe } from "@/server/realtime/publish";
import { CALLED_BACK_TAG, isCalledBack } from "@/lib/calls/call-state";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../calls/[id]/called-back
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  { roles: [...CALL_CENTER_ROLES] },
  async ({ request, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);

    const before = await prisma.call.findUnique({
      where: { id },
      select: {
        id: true,
        direction: true,
        tags: true,
        patientId: true,
        sipCallId: true,
        fromNumber: true,
        toNumber: true,
      },
    });
    if (!before) return notFound();
    if (before.direction !== "MISSED") return conflict("not_missed_call");
    if (isCalledBack(before.tags)) return ok({ id, calledBack: true });

    const now = new Date();
    await prisma.call.update({
      where: { id },
      data: { tags: [...before.tags, CALLED_BACK_TAG] },
    });

    // Every open call center and badge refetches its lists on a call event.
    publishEventSafe(ctx.clinicId, {
      type: "call.ended",
      payload: {
        callId: before.sipCallId ?? before.id,
        dbId: before.id,
        from: before.fromNumber,
        to: before.toNumber,
        calledBack: true,
      },
    });
    await audit(request, {
      action: "call.called_back",
      entityType: "Call",
      entityId: id,
      meta: { patientId: before.patientId, at: now.toISOString() },
    });
    return ok({ id, calledBack: true });
  },
);
