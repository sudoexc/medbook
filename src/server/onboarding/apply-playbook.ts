/**
 * Phase 19 Wave 2 — onboarding playbook applier.
 *
 * Materialises a `Playbook` bundle into a freshly-created Clinic:
 *   - services (skipping any whose `code` already exists for this clinic)
 *   - notification templates (skipping any whose `key` already exists)
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
      const existingKeys = new Set(
        (
          await prisma.notificationTemplate.findMany({
            where: { clinicId },
            select: { key: true },
          })
        ).map((r: { key: string }) => r.key),
      );

      let templatesCreated = 0;
      for (const tpl of pb.templates) {
        const shape = triggerKeyToDbShape(tpl.trigger);
        if (!shape) continue;
        if (existingKeys.has(shape.key)) continue;
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
