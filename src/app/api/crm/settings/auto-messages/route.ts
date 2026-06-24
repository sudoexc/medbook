/**
 * /api/crm/settings/auto-messages — the CRM «Авто-сообщения» widget backend.
 *
 * Three clinic-configurable Telegram automations, each backed 1:1 by a
 * NotificationTemplate row (see `src/server/notifications/auto-messages.ts`):
 *
 *   welcome   — patient.welcome          (bot FSM, first contact)
 *   reminder  — appointment.reminder-24h (scheduler, 24h before)
 *   thankYou  — appointment.thank-you    (trigger, after COMPLETED)
 *
 * GET   → the three rows in widget order (auto-provisioned on first read).
 * PATCH → flip `isActive` (toggle) and/or edit `bodyRu` (message text). There
 *         is NO parallel sender — the existing materialise → NotificationSend
 *         pipeline (and the FSM, for welcome) reads these same rows.
 *
 * `welcome` is sent VERBATIM by the bot FSM and never runs through the
 * template renderer, so its body must contain no `{{…}}` placeholders — the
 * validator rejects any (see `allowedKeysForKind`).
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, forbidden, diff } from "@/server/http";
import { validate } from "@/server/notifications/template";
import {
  AUTO_MESSAGE_KEYS,
  allowedKeysForKind,
  ensureAutoMessageTemplates,
  getAutoMessages,
  type AutoMessageKind,
} from "@/server/notifications/auto-messages";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    return ok({ messages: await getAutoMessages(ctx.clinicId) });
  },
);

const PatchSchema = z.object({
  messages: z
    .array(
      z.object({
        kind: z.enum(["welcome", "reminder", "thankYou"]),
        enabled: z.boolean().optional(),
        text: z.string().max(10_000).optional(),
      }),
    )
    .min(1),
});

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: PatchSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const clinicId = ctx.clinicId;

    // Provision any missing rows so the compound-key updates below always hit
    // (a clinic that predates this widget has no rows yet).
    await ensureAutoMessageTemplates(clinicId);

    // Validate everything before touching the DB so a bad placeholder in the
    // 2nd message doesn't leave the 1st already written.
    type Patch = {
      kind: AutoMessageKind;
      key: string;
      data: Record<string, unknown>;
    };
    const patches: Patch[] = [];
    for (const m of body.messages) {
      const data: Record<string, unknown> = {};
      if (typeof m.text === "string") {
        if (m.text.trim().length === 0) {
          return err("EmptyBody", 400, { kind: m.kind, field: "text" });
        }
        const allowed = allowedKeysForKind(m.kind);
        const v = validate(m.text, allowed);
        if (!v.ok) {
          return err("UnknownPlaceholder", 400, {
            kind: m.kind,
            field: "text",
            unknown: v.unknown,
            allowed,
          });
        }
        data.bodyRu = m.text;
      }
      if (typeof m.enabled === "boolean") {
        data.isActive = m.enabled;
      }
      if (Object.keys(data).length === 0) continue;
      patches.push({ kind: m.kind, key: AUTO_MESSAGE_KEYS[m.kind], data });
    }

    if (patches.length === 0) return err("EmptyPatch", 400);

    const changes = await prisma.$transaction(async (tx) => {
      const out: Record<string, unknown>[] = [];
      for (const p of patches) {
        const where = { clinicId_key: { clinicId, key: p.key } };
        const before = await tx.notificationTemplate.findUnique({
          where,
          select: { isActive: true, bodyRu: true },
        });
        if (!before) continue; // ensure ran above; defensive.
        const after = await tx.notificationTemplate.update({
          where,
          data: p.data as never,
          select: { isActive: true, bodyRu: true },
        });
        out.push({
          kind: p.kind,
          key: p.key,
          ...diff(
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
          ),
        });
      }
      return out;
    });

    await audit(request, {
      action: "settings.auto-messages.update",
      entityType: "NotificationTemplate",
      entityId: clinicId,
      meta: { changes },
    });

    return ok({ messages: await getAutoMessages(clinicId) });
  },
);
