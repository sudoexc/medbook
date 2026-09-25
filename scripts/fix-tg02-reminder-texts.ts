/**
 * Audit TG-02 data fix: reminder texts already stored with the old faults.
 *
 *   1. Templates. Clinics onboarded from a playbook got the 24h and 2h
 *      reminders ending in «Чтобы подтвердить, ответьте YES (или ДА / HA).»
 *      (UZ: «Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering.»). Nothing
 *      parses a text reply, so a patient who answered «ДА» stayed
 *      unconfirmed. A body still equal to the playbook's original text is
 *      replaced by the playbook's current one; any other body only loses that
 *      sentence (an admin's own wording is kept).
 *
 *   2. Queued reminders. A reminder with a custom offset (not the 5d/3d/1d/3h
 *      cascade) was rendered by the scheduler's dynamic pass with no time, no
 *      doctor and an empty clinic, always in Russian: «напоминаем: завтра в
 *      вы записаны к в .». Every such row still QUEUED for the future is
 *      rendered again from its (fixed) template, the way the scheduler now
 *      does it: full appointment context, in the patient's language.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-tg02-reminder-texts.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-tg02-reminder-texts.ts
 *
 * Idempotent: a fixed template no longer matches, and a re-rendered row
 * renders to the same text again (no change, not counted).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { PLAYBOOKS } from "../src/server/onboarding/playbooks";
import {
  APPOINTMENT_REFS_INCLUDE,
  renderAppointmentBody,
  type AppointmentWithRefs,
} from "../src/server/notifications/triggers";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

/** The playbook texts as they were before the fix, word for word. */
const OLD_TO_NEW: Record<string, "ru24" | "uz24" | "ru2" | "uz2"> = {
  "Напоминание: завтра в {{appointment.time}} у вас приём в {{clinic.name}} — {{appointment.doctor}}. Адрес: {{clinic.address}}. Чтобы подтвердить, ответьте YES (или ДА / HA).":
    "ru24",
  "Eslatma: ertaga soat {{appointment.time}} da {{clinic.name}}da qabuluvingiz bor — {{appointment.doctor}}. Manzil: {{clinic.address}}. Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering.":
    "uz24",
  "Через 2 часа ваш приём в {{clinic.name}} ({{appointment.doctor}}). Если не сможете — позвоните: {{clinic.phone}}. Чтобы подтвердить, ответьте YES (или ДА / HA).":
    "ru2",
  "2 soatdan so'ng {{clinic.name}}da qabuluvingiz bor ({{appointment.doctor}}). Kelolmasangiz qo'ng'iroq qiling: {{clinic.phone}}. Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering.":
    "uz2",
};

const YES_SENTENCE =
  /\s*(Чтобы подтвердить, ответьте YES \(или ДА \/ HA\)\.|Tasdiqlash uchun HA \(yoki YES \/ ДА\) deb javob bering\.)/g;

/** The playbooks' current 24h / 2h texts (all playbooks share them). */
function currentTexts(): Record<"ru24" | "uz24" | "ru2" | "uz2", string> {
  const tpls = Object.values(PLAYBOOKS)[0]!.templates;
  const t24 = tpls.find((t) => t.trigger === "appointment.reminder-24h")!;
  const t2 = tpls.find((t) => t.trigger === "appointment.reminder-2h")!;
  return { ru24: t24.bodyRu, uz24: t24.bodyUz, ru2: t2.bodyRu, uz2: t2.bodyUz };
}

function fixBody(body: string, fresh: ReturnType<typeof currentTexts>): string {
  const whole = OLD_TO_NEW[body];
  if (whole) return fresh[whole];
  return body.replace(YES_SENTENCE, "");
}

const CANONICAL_OFFSETS = new Set([-7200, -4320, -1440, -180]);

async function fixTemplates(): Promise<number> {
  const fresh = currentTexts();
  const rows = await prisma.notificationTemplate.findMany({
    where: {
      OR: [
        { bodyRu: { contains: "ответьте YES" } },
        { bodyUz: { contains: "deb javob bering" } },
      ],
    },
    select: { id: true, clinicId: true, key: true, bodyRu: true, bodyUz: true },
  });
  let changed = 0;
  for (const row of rows) {
    const bodyRu = fixBody(row.bodyRu, fresh);
    const bodyUz = fixBody(row.bodyUz, fresh);
    if (bodyRu === row.bodyRu && bodyUz === row.bodyUz) continue;
    changed += 1;
    console.log(`  template ${row.clinicId}/${row.key}`);
    console.log(`    ru: ${bodyRu}`);
    console.log(`    uz: ${bodyUz}`);
    if (APPLY) {
      await prisma.notificationTemplate.update({
        where: { id: row.id },
        data: { bodyRu, bodyUz },
      });
    }
  }
  return changed;
}

async function rerenderQueued(): Promise<number> {
  const fresh = currentTexts();
  const rows = await prisma.notificationSend.findMany({
    where: {
      status: "QUEUED",
      scheduledFor: { gt: new Date() },
      appointmentId: { not: null },
      template: { trigger: "APPOINTMENT_BEFORE" },
    },
    select: {
      id: true,
      body: true,
      appointmentId: true,
      template: { select: { bodyRu: true, bodyUz: true, triggerConfig: true } },
    },
  });
  // Only the custom-offset rows came from the broken pass.
  const dynamic = rows.filter((r) => {
    const off = (r.template?.triggerConfig as { offsetMin?: unknown } | null)
      ?.offsetMin;
    return typeof off === "number" && !CANONICAL_OFFSETS.has(off);
  });
  const apptIds = Array.from(new Set(dynamic.map((r) => r.appointmentId!)));
  const appts = new Map(
    (
      (await prisma.appointment.findMany({
        where: { id: { in: apptIds } },
        include: APPOINTMENT_REFS_INCLUDE,
      })) as unknown as AppointmentWithRefs[]
    ).map((a) => [a.id, a]),
  );

  let changed = 0;
  for (const row of dynamic) {
    const appt = appts.get(row.appointmentId!);
    if (!appt || !row.template) continue;
    // From the template as step 1 leaves it, so the dry run shows the
    // exact text the apply writes.
    const body = renderAppointmentBody(
      {
        bodyRu: fixBody(row.template.bodyRu, fresh),
        bodyUz: fixBody(row.template.bodyUz, fresh),
      },
      appt,
    );
    if (body === row.body) continue;
    changed += 1;
    console.log(`  send ${row.id}: «${row.body}» → «${body}»`);
    if (APPLY) {
      // Still QUEUED: never rewrite a row the worker has claimed meanwhile.
      await prisma.notificationSend.updateMany({
        where: { id: row.id, status: "QUEUED" },
        data: { body },
      });
    }
  }
  return changed;
}

async function main() {
  console.log(`┌─ ${APPLY ? "APPLY" : "DRY RUN"}: TG-02 reminder texts`);
  const templates = await fixTemplates();
  // Templates first: the queued rows are rendered from the fixed text.
  const sends = await rerenderQueued();
  console.log(
    `└─ templates ${APPLY ? "fixed" : "to fix"}: ${templates}, queued reminders ${APPLY ? "re-rendered" : "to re-render"}: ${sends}` +
      (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
