/**
 * Reactivation campaign launcher.
 *
 * Called by `POST /api/crm/campaigns/[id]/launch`. The whole materialise +
 * status-flip + action-close happens inside a single Prisma transaction so a
 * mid-flight crash leaves the campaign back in DRAFT with zero NotificationSend
 * rows. The actual delivery jobs are enqueued AFTER the transaction commits;
 * if enqueue throws we don't roll back the campaign (the QUEUED rows can be
 * retried via the notifications scheduler or manual /retry endpoint).
 *
 * Idempotency: re-launching a campaign that is already SENDING or SENT is
 * a no-op that returns the prior totals. The check happens inside the tx so
 * two concurrent clicks can't double-send.
 */
import { prisma } from "@/lib/prisma";
import type { NotificationStatus } from "@/generated/prisma/client";
import { render } from "@/server/notifications/template";

import {
  resolveDormantAudience,
  type AudiencePatient,
} from "./dormant-audience";
import type { CampaignChannel, CampaignSegment } from "@/server/schemas/campaign";
import { enqueue } from "@/server/queue";
import { QUEUE_NAME, JOB_NAME } from "@/server/workers/notifications-send";

type CampaignRow = {
  id: string;
  clinicId: string;
  name: string;
  channel: "TG" | "SMS" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
  status: string;
  templateId: string | null;
  segment: unknown;
  totalCount: number;
};

type TemplateRow = {
  id: string;
  bodyRu: string;
  bodyUz: string;
};

type ClinicRow = {
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
};

export type LaunchResult = {
  campaignId: string;
  status: string;
  totalCount: number;
  alreadyLaunched: boolean;
};

function pickBodyTemplate(template: TemplateRow, lang: "RU" | "UZ"): string {
  return lang === "UZ" ? template.bodyUz : template.bodyRu;
}

function pickClinicName(clinic: ClinicRow, lang: "RU" | "UZ"): string {
  return lang === "UZ" ? clinic.nameUz : clinic.nameRu;
}

function pickClinicAddress(clinic: ClinicRow, lang: "RU" | "UZ"): string {
  return (lang === "UZ" ? clinic.addressUz : clinic.addressRu) ?? "";
}

function patientFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  // Russian-style "Фамилия Имя Отчество" — first name is the second token.
  // Fall back to the only token if there's just one.
  const parts = trimmed.split(/\s+/);
  return parts[1] ?? parts[0] ?? "";
}

function buildBody(args: {
  body: string;
  patient: AudiencePatient;
  clinic: ClinicRow;
  lang: "RU" | "UZ";
}): string {
  const lang = args.lang;
  const ctx = {
    patient: {
      name: args.patient.fullName,
      firstName: patientFirstName(args.patient.fullName),
    },
    clinic: {
      name: pickClinicName(args.clinic, lang),
      phone: args.clinic.phone ?? "",
      address: pickClinicAddress(args.clinic, lang),
    },
  };
  return render(args.body, ctx);
}

function recipientFor(channel: CampaignChannel, patient: AudiencePatient): string | null {
  if (channel === "TG") return patient.telegramId;
  if (channel === "SMS") return patient.phone;
  return null;
}

/**
 * Materialise NotificationSend rows for the campaign's audience and flip the
 * campaign into SENDING. Returns `{ alreadyLaunched: true }` if the row is
 * already past DRAFT.
 *
 * The caller is expected to have validated RBAC + ownership; this function
 * assumes the campaign belongs to the active clinic.
 */
export async function launchCampaign(args: {
  campaignId: string;
  sourceActionId?: string | null;
  now?: Date;
}): Promise<LaunchResult> {
  const now = args.now ?? new Date();

  // Read upfront — these don't need to be inside the tx because the launch
  // gate inside the tx re-checks the campaign row by id and bumps status under
  // a lock-equivalent (status === 'DRAFT' guard).
  const campaign = (await prisma.campaign.findUnique({
    where: { id: args.campaignId },
  })) as CampaignRow | null;
  if (!campaign) {
    throw Object.assign(new Error("CampaignNotFound"), { status: 404 });
  }
  if (campaign.status !== "DRAFT") {
    return {
      campaignId: campaign.id,
      status: campaign.status,
      totalCount: campaign.totalCount,
      alreadyLaunched: true,
    };
  }
  if (campaign.channel !== "TG" && campaign.channel !== "SMS") {
    throw Object.assign(
      new Error(`UnsupportedChannel:${campaign.channel}`),
      { status: 400 },
    );
  }

  const segment = campaign.segment as CampaignSegment | null;
  if (!segment || segment.kind !== "dormant") {
    throw Object.assign(new Error("UnsupportedSegmentKind"), { status: 400 });
  }

  const [template, clinic] = await Promise.all([
    campaign.templateId
      ? (prisma.notificationTemplate.findUnique({
          where: { id: campaign.templateId },
          select: { id: true, bodyRu: true, bodyUz: true },
        }) as Promise<TemplateRow | null>)
      : Promise.resolve(null),
    prisma.clinic.findUnique({
      where: { id: campaign.clinicId },
      select: {
        nameRu: true,
        nameUz: true,
        phone: true,
        addressRu: true,
        addressUz: true,
      },
    }) as Promise<ClinicRow | null>,
  ]);

  if (!clinic) {
    throw Object.assign(new Error("ClinicMissing"), { status: 500 });
  }
  if (campaign.templateId && !template) {
    throw Object.assign(new Error("TemplateMissing"), { status: 400 });
  }

  const channel = campaign.channel as CampaignChannel;
  const audienceRes = await resolveDormantAudience({
    bucket: segment.bucket,
    channel,
    now,
  });

  if (!template) {
    throw Object.assign(new Error("TemplateRequired"), { status: 400 });
  }

  const rows = audienceRes.patients
    .map((patient) => {
      const recipient = recipientFor(channel, patient);
      if (!recipient) return null;
      const sourceBody = pickBodyTemplate(template, patient.preferredLang);
      const body = buildBody({
        body: sourceBody,
        patient,
        clinic,
        lang: patient.preferredLang,
      });
      return {
        clinicId: campaign.clinicId,
        campaignId: campaign.id,
        templateId: campaign.templateId,
        patientId: patient.id,
        channel: campaign.channel,
        recipient,
        body,
        scheduledFor: now,
        status: "QUEUED" as NotificationStatus,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    // Mark the campaign DONE-with-zero-sends so the user gets immediate feedback
    // and the row no longer shows up as DRAFT.
    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "DONE",
        startedAt: now,
        finishedAt: now,
        totalCount: 0,
      },
    });
    return {
      campaignId: updated.id,
      status: updated.status,
      totalCount: 0,
      alreadyLaunched: false,
    };
  }

  // Single transaction: insert sends, flip campaign, optionally close action.
  const result = await prisma.$transaction(async (tx) => {
    // Status guard — concurrent click protection.
    const fresh = await tx.campaign.findUnique({
      where: { id: campaign.id },
      select: { status: true },
    });
    if (!fresh || fresh.status !== "DRAFT") {
      return { totalCount: 0, alreadyLaunched: true as const };
    }

    await tx.notificationSend.createMany({
      data: rows as never,
    });

    const inserted = await tx.notificationSend.findMany({
      where: { campaignId: campaign.id, status: "QUEUED" },
      select: { id: true },
    });

    await tx.campaign.update({
      where: { id: campaign.id },
      data: {
        status: "SENDING",
        startedAt: now,
        totalCount: inserted.length,
      },
    });

    if (args.sourceActionId) {
      const action = await tx.action.findUnique({
        where: { id: args.sourceActionId },
        select: { id: true, status: true },
      });
      if (action && action.status === "OPEN") {
        await tx.action.update({
          where: { id: action.id },
          data: { status: "DONE", doneAt: now },
        });
      }
    }

    return {
      totalCount: inserted.length,
      sendIds: inserted.map((r) => r.id),
      alreadyLaunched: false as const,
    };
  });

  if (result.alreadyLaunched) {
    return {
      campaignId: campaign.id,
      status: "SENDING",
      totalCount: 0,
      alreadyLaunched: true,
    };
  }

  // Best-effort enqueue. The notifications scheduler picks QUEUED rows whose
  // scheduledFor has elapsed, so a missed enqueue here just delays delivery
  // until the next tick rather than dropping the send.
  for (const sendId of result.sendIds ?? []) {
    try {
      await enqueue(QUEUE_NAME, JOB_NAME, { sendId });
    } catch (e) {
      console.warn(
        `[campaign:launch] enqueue failed for sendId=${sendId}`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return {
    campaignId: campaign.id,
    status: "SENDING",
    totalCount: result.totalCount,
    alreadyLaunched: false,
  };
}
