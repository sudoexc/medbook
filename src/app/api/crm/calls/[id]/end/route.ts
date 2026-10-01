/**
 * POST /api/crm/calls/[id]/end — the operator's «Завершить» / «Пропуск»
 * (audit CM-07).
 *
 * Body: `{ outcome: "ENDED" | "MISSED" }`.
 *
 * Both buttons used to PATCH `endedAt` (and a `missed` tag nobody read): the
 * status stayed RINGING, so the card kept reading «Звонит» with an active
 * «Завершить», the missed call never reached the missed counters (they read
 * `direction = MISSED`), no duration was written, and the other operators
 * kept the call in their queue until their next poll. A later PBX hangup
 * saw `endedAt` and left the status RINGING for good.
 *
 * Now the call closes the way the webhook closes one (`@/lib/calls/call-state`):
 *   ENDED  → status ENDED, talk time from the PBX's answer moment if known;
 *   MISSED → status MISSED, an inbound call takes direction MISSED, no
 *            duration, so it is counted and listed for a call back.
 * The write is guarded on `endedAt: null`; a call already closed answers 409
 * `call_already_ended`. `call.ended` / `call.missed` is published so every
 * operator's queue drops the call at once.
 */
import { createApiHandler } from "@/lib/api-handler";
import { CALL_CENTER_ROLES } from "@/lib/calls/roles";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { conflict, err, notFound, ok } from "@/server/http";
import { EndCallSchema } from "@/server/schemas/call";
import { ensureFeature } from "@/server/platform/feature-guard";
import { publishEventSafe } from "@/server/realtime/publish";
import {
  isCallOver,
  missedUpdate,
  operatorEndUpdate,
} from "@/lib/calls/call-state";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../calls/[id]/end
  return parts[parts.length - 2] ?? "";
}

export const POST = createApiHandler(
  {
    roles: [...CALL_CENTER_ROLES],
    bodySchema: EndCallSchema,
  },
  async ({ request, body, ctx }) => {
    const block = await ensureFeature(ctx, "hasCallCenter");
    if (block) return block;
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const id = idFromUrl(request);

    const before = await prisma.call.findUnique({
      where: { id },
      select: {
        id: true,
        direction: true,
        status: true,
        answeredAt: true,
        endedAt: true,
        sipCallId: true,
        fromNumber: true,
        toNumber: true,
        operatorId: true,
      },
    });
    if (!before) return notFound();
    if (isCallOver(before)) return conflict("call_already_ended");

    const now = new Date();
    const data =
      body.outcome === "MISSED"
        ? missedUpdate(before, now)
        : operatorEndUpdate(before, now);
    const res = await prisma.call.updateMany({
      where: { id, endedAt: null },
      data: {
        ...data,
        // The operator who closed an unassigned call handled it.
        ...(before.operatorId ? {} : { operatorId: ctx.userId }),
      },
    });
    if (res.count === 0) return conflict("call_already_ended");

    const after = await prisma.call.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, segment: true } },
        operator: { select: { id: true, name: true } },
      },
    });

    publishEventSafe(ctx.clinicId, {
      type: body.outcome === "MISSED" ? "call.missed" : "call.ended",
      payload: {
        callId: before.sipCallId ?? before.id,
        dbId: before.id,
        from: before.fromNumber,
        to: before.toNumber,
      },
    });
    await audit(request, {
      action: body.outcome === "MISSED" ? "call.mark_missed" : "call.end",
      entityType: "Call",
      entityId: id,
      meta: {
        statusBefore: before.status,
        status: data.status,
        direction: data.direction ?? before.direction,
        durationSec: data.durationSec,
      },
    });
    return ok(after);
  },
);
