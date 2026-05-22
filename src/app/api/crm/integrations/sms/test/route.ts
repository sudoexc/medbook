/**
 * POST /api/crm/integrations/sms/test — send a test SMS through the clinic's
 * configured SMS adapter so admins can verify the integration end-to-end.
 *
 * Adapter selection mirrors the production worker: `resolveAdapters(clinicId)`
 * picks `LogOnly` when no `ProviderConnection` row is active for SMS, or the
 * real provider (`Eskiz`) when one is. The route records a Communication
 * row with the real outcome (provider id on success, error on failure) — no
 * stub metadata. The UI surfaces `adapter` + `real` so the admin can tell
 * whether a real SMS was actually billed.
 *
 * ADMIN only.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { TestSmsSchema } from "@/server/schemas/settings";
import { resolveAdapters } from "@/server/notifications/adapters";

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: TestSmsSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const adapters = await resolveAdapters(ctx.clinicId);
    const adapterName = adapters.sms.name;
    const real = adapters.real.sms;

    let providerId: string | null = null;
    let status: "SENT" | "FAILED" = "SENT";
    let failedReason: string | null = null;
    try {
      const res = await adapters.sms.send(body.phone, body.body);
      providerId = res.providerId;
    } catch (e) {
      status = "FAILED";
      failedReason = e instanceof Error ? e.message : String(e);
    }

    const comm = await prisma.communication.create({
      data: {
        patientId: null,
        channel: "SMS",
        direction: "OUT",
        subject: null,
        body: body.body,
        meta: {
          phone: body.phone,
          test: true,
          adapter: adapterName,
          real,
          status,
          providerId,
          ...(failedReason ? { failedReason } : {}),
        },
      } as never,
    });
    await audit(request, {
      action: "integration.sms.test",
      entityType: "Communication",
      entityId: comm.id,
      meta: {
        phone: body.phone,
        adapter: adapterName,
        real,
        status,
        ...(failedReason ? { failedReason } : {}),
      },
    });

    if (status === "FAILED") {
      return err("SmsTestFailed", 502, {
        id: comm.id,
        adapter: adapterName,
        real,
        failedReason,
      });
    }
    return ok(
      { id: comm.id, status: "sent", adapter: adapterName, real, providerId },
      202,
    );
  }
);
