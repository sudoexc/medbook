/**
 * Phase 19 Wave 2 — onboarding playbook applier.
 *
 * Materialises a `Playbook` bundle into a freshly-created Clinic:
 *   - services (skipping any whose `code` already exists for this clinic)
 *   - notification templates (skipping any whose `key` already exists):
 *     the playbook's own wording first, then every canonical appointment
 *     template (`DEFAULT_APPOINTMENT_TEMPLATES`) whose event has none yet
 *   - workday/slot defaults on the Clinic row
 *
 * Idempotency: re-running the same `applyPlaybook(clinicId, slug)` is safe
 * — the unique constraints on `(clinicId, code)` for Service and
 * `(clinicId, key)` for NotificationTemplate let us skip rows that already
 * exist instead of throwing.
 *
 * Audit: emits exactly one `PLAYBOOK_APPLIED` row with the per-table counts.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";

import { DEFAULT_APPOINTMENT_TEMPLATES } from "@/server/notifications/default-templates";
import { templateSlot } from "@/server/notifications/template-events";

import {
  PLAYBOOKS,
  triggerKeyToDbShape,
  type PlaybookSlug,
} from "./playbooks";

export interface ApplyPlaybookResult {
  servicesCreated: number;
  templatesCreated: number;
  scheduleSet: boolean;
}

export async function applyPlaybook(
  clinicId: string,
  slug: PlaybookSlug,
): Promise<ApplyPlaybookResult> {
  const pb = PLAYBOOKS[slug];

  return runWithTenant(
    {
      kind: "TENANT",
      clinicId,
      // The applier creates clinic-bootstrap content; it has no real user
      // yet (the ADMIN row landed in the same transaction but is not
      // available here) so we synthesise an ADMIN context. The Prisma
      // extension only cares about clinicId scoping.
      userId: "system",
      role: "ADMIN",
      branchId: undefined,
    },
    async () => {
      // ── Services ──────────────────────────────────────────────────────
      // Pull existing codes once and dedupe in JS — avoids a per-row
      // SELECT and keeps the applier fast on a fresh clinic.
      const existingCodes = new Set(
        (
          await prisma.service.findMany({
            where: { clinicId },
            select: { code: true },
          })
        ).map((r: { code: string }) => r.code),
      );

      let servicesCreated = 0;
      for (const svc of pb.services) {
        if (existingCodes.has(svc.code)) continue;
        await prisma.service.create({
          data: {
            // The Prisma extension auto-injects clinicId for tenant
            // contexts, but we set it explicitly so the create works
            // identically under unit-test mocks that don't load the
            // extension.
            clinicId,
            code: svc.code,
            nameRu: svc.nameRu,
            nameUz: svc.nameUz,
            durationMin: svc.durationMin,
            // `Service.priceBase` is Int, in tiins. Playbook prices are
            // already in tiins (see PlaybookService docs).
            priceBase: svc.priceTiins,
            isActive: true,
          } as never,
        });
        servicesCreated += 1;
      }

      // ── Notification templates ────────────────────────────────────────
      const existing = (await prisma.notificationTemplate.findMany({
        where: { clinicId },
        select: { key: true, trigger: true, triggerConfig: true },
      })) as Array<{ key: string; trigger?: string; triggerConfig?: unknown }>;
      const existingKeys = new Set(existing.map((r) => r.key));
      // Events that already have a template, switched off ones included: a
      // second active row for one event is the duplicate audit TG-22 is
      // about, and an event an admin switched off stays off.
      const occupied = new Set(
        existing
          .map((r) =>
            templateSlot({ key: r.key, trigger: r.trigger ?? "", triggerConfig: r.triggerConfig }),
          )
          .filter((x): x is string => x !== null),
      );

      let templatesCreated = 0;
      for (const tpl of pb.templates) {
        const shape = triggerKeyToDbShape(tpl.trigger);
        if (!shape) continue;
        if (existingKeys.has(shape.key)) continue;
        const slot = templateSlot(shape);
        if (slot && occupied.has(slot)) continue;
        await prisma.notificationTemplate.create({
          data: {
            clinicId,
            key: shape.key,
            nameRu: `${pb.nameRu}: ${shape.key}`,
            nameUz: `${pb.nameUz}: ${shape.key}`,
            channel: tpl.channel,
            category: "REMINDER",
            bodyRu: tpl.bodyRu,
            bodyUz: tpl.bodyUz,
            buttons: null,
            variables: [],
            trigger: shape.trigger,
            triggerConfig: (shape.triggerConfig ?? null) as never,
            isActive: true,
          } as never,
        });
        existingKeys.add(shape.key);
        if (slot) occupied.add(slot);
        templatesCreated += 1;
      }

      // Audit TG-16: the playbook alone gave a new clinic no template for a
      // cancellation, a reschedule, a no-show, a late patient or the 5-day
      // band, so those events reached nobody and nothing said so. Every
      // canonical template is added for each event still without one.
      for (const def of DEFAULT_APPOINTMENT_TEMPLATES) {
        if (existingKeys.has(def.key)) continue;
        const slot = templateSlot(def);
        if (slot && occupied.has(slot)) continue;
        await prisma.notificationTemplate.create({
          data: {
            clinicId,
            key: def.key,
            nameRu: def.nameRu,
            nameUz: def.nameUz,
            channel: def.channel,
            category: def.category,
            bodyRu: def.bodyRu,
            bodyUz: def.bodyUz,
            buttons: null,
            variables: def.variables,
            trigger: def.trigger,
            triggerConfig: (def.triggerConfig ?? undefined) as never,
            isActive: true,
          } as never,
        });
        existingKeys.add(def.key);
        if (slot) occupied.add(slot);
        templatesCreated += 1;
      }

      // ── Schedule defaults on the Clinic row ───────────────────────────
      // Always overwrite — the clinic was just created with the global
      // defaults; the playbook's choice is more specific.
      await prisma.clinic.update({
        where: { id: clinicId },
        data: {
          workdayStart: pb.schedule.workdayStart,
          workdayEnd: pb.schedule.workdayEnd,
          slotMin: pb.schedule.slotMin,
        },
      });

      // ── Audit ─────────────────────────────────────────────────────────
      await prisma.auditLog.create({
        data: {
          clinicId,
          action: AUDIT_ACTION.PLAYBOOK_APPLIED,
          entityType: "Clinic",
          entityId: clinicId,
          meta: {
            slug,
            servicesCreated,
            templatesCreated,
            scheduleSet: true,
          } as never,
          actorId: null,
          actorRole: "SYSTEM",
          actorLabel: "onboarding-playbook",
        },
      });

      return {
        servicesCreated,
        templatesCreated,
        scheduleSet: true,
      };
    },
  );
}
