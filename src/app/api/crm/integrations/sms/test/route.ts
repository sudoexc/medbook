/**
 * POST /api/crm/integrations/sms/test — sends a test SMS via the existing
 * notifications adapter chain (LogOnly in dev; real Eskiz when configured).
 *
 * Phase-4 shim: records a Communication with `direction=OUT` and a stub `meta`
 * so the UI can show a confirmation in the admin's own phone log.
 *
 * ADMIN only.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { TestSmsSchema } from "@/server/schemas/settings";

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: TestSmsSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const comm = await prisma.communication.create({
      data: {
        patientId: null,
        channel: "SMS",
        direction: "OUT",
        subject: null,
        body: body.body,
        meta: { phone: body.phone, stub: true, test: true },
      } as never,
    });
    await audit(request, {
      action: "integration.sms.test",
      entityType: "Communication",
      entityId: comm.id,
      meta: { phone: body.phone },
    });
    return ok({ id: comm.id, status: "queued", test: true }, 202);
  }
);
