/**
 * /api/crm/notifications/triggers — the events CRM messages patients on by
 * itself, each with the template the dispatcher really sends for it.
 *
 * Audit TG-25: this list used to match templates by `key` against
 * TRIGGER_KEYS, while the dispatcher picks by `trigger` enum + offset /
 * audience. The real cancellation templates (keys `.by-staff` / `.by-patient`)
 * read «нужен шаблон» although cancellations went out, and the delays were
 * hard-coded labels. Rows now come from `TEMPLATE_EVENTS` and the template is
 * resolved by `findActiveTemplateFor`, the dispatcher's own lookup. An event
 * without any template is flagged (audit TG-16), so a clinic sees which
 * messages nobody receives.
 *
 * GET   → one row per event.
 * PATCH → `{ event, enabled }`: off switches every template of the event
 *         off (a legacy duplicate would otherwise take over), on switches on
 *         the event's most recently edited template.
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { err, forbidden, ok } from "@/server/http";
import {
  TEMPLATE_EVENTS,
  templateEventById,
  templateSlot,
  type TemplateEvent,
} from "@/server/notifications/template-events";
import { retireSlotRivals, slotTemplates } from "@/server/notifications/template-slot";
import { findActiveTemplateFor, type TriggerKey } from "@/server/notifications/triggers";

type TemplateRow = {
  id: string;
  key: string;
  nameRu: string;
  nameUz: string;
  channel: string;
  isActive: boolean;
  trigger: string;
  triggerConfig: unknown;
  updatedAt: Date;
};

function eventSlot(event: TemplateEvent): string | null {
  return templateSlot({ ...event, key: "" });
}

function daysBefore(triggerConfig: unknown): number {
  const v = (triggerConfig as { daysBefore?: unknown } | null)?.daysBefore;
  return typeof v === "number" && v > 0 ? v : 2;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const clinicId = ctx.clinicId;
    const all = (await prisma.notificationTemplate.findMany({
      where: { clinicId },
      select: {
        id: true,
        key: true,
        nameRu: true,
        nameUz: true,
        channel: true,
        isActive: true,
        trigger: true,
        triggerConfig: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    })) as TemplateRow[];
    const byId = new Map(all.map((t) => [t.id, t]));

    const rows = [];
    for (const event of TEMPLATE_EVENTS) {
      const live = await findActiveTemplateFor(clinicId, event.id as TriggerKey);
      // No active template: the event's newest switched-off one, if any.
      const slot = eventSlot(event);
      const fallback = live
        ? null
        : (all.find((t) => slot !== null && templateSlot(t) === slot) ?? null);
      const tpl = live ? (byId.get(live.templateId) ?? null) : fallback;
      rows.push({
        key: event.id,
        label: event.label,
        timing: event.timing,
        timingValues:
          event.id === "case.repeat-due"
            ? { days: daysBefore(tpl?.triggerConfig ?? event.triggerConfig) }
            : {},
        template: tpl
          ? {
              id: tpl.id,
              key: tpl.key,
              isActive: tpl.isActive,
              channel: tpl.channel,
              nameRu: tpl.nameRu,
              nameUz: tpl.nameUz,
            }
          : null,
        active: live !== null,
      });
    }
    return ok({ rows });
  },
);

const PatchSchema = z.object({
  event: z.string().min(1).max(100),
  enabled: z.boolean(),
});

export const PATCH = createApiHandler(
  { roles: ["ADMIN"], bodySchema: PatchSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const clinicId = ctx.clinicId;
    const event = templateEventById(body.event);
    if (!event) return err("UnknownEvent", 400, { event: body.event });

    const changed: string[] = [];
    if (!body.enabled) {
      // Every template the dispatcher would fall back to, tier by tier.
      for (let i = 0; i < 3; i += 1) {
        const live = await findActiveTemplateFor(clinicId, event.id as TriggerKey);
        if (!live) break;
        const tpl = await prisma.notificationTemplate.findUnique({
          where: { id: live.templateId },
          select: { key: true, trigger: true, triggerConfig: true },
        });
        const slot = tpl ? templateSlot(tpl) : null;
        const ids = slot
          ? (await slotTemplates(prisma, clinicId, slot)).map((t) => t.id)
          : [live.templateId];
        await prisma.notificationTemplate.updateMany({
          where: { id: { in: ids }, clinicId },
          data: { isActive: false },
        });
        changed.push(...ids);
      }
    } else if (!(await findActiveTemplateFor(clinicId, event.id as TriggerKey))) {
      const slot = eventSlot(event);
      const candidates = slot
        ? await slotTemplates(prisma, clinicId, slot, { activeOnly: false })
        : [];
      const pick = (
        await prisma.notificationTemplate.findMany({
          where: { clinicId, id: { in: candidates.map((c) => c.id) } },
          select: { id: true },
          orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
          take: 1,
        })
      )[0];
      if (!pick) return err("NoTemplate", 409, { event: event.id });
      await prisma.$transaction(async (tx) => {
        await tx.notificationTemplate.update({
          where: { id: pick.id },
          data: { isActive: true },
        });
        await retireSlotRivals(tx, pick.id);
      });
      changed.push(pick.id);
    }

    await audit(request, {
      action: "template.update",
      entityType: "NotificationTemplate",
      entityId: changed[0] ?? clinicId,
      meta: { event: event.id, enabled: body.enabled, templateIds: changed },
    });
    return ok({ event: event.id, enabled: body.enabled, templateIds: changed });
  },
);
