/**
 * Zod schemas for the /api/crm/campaigns surface.
 *
 * Today the only supported segment kind is `dormant` (the bucket comes from
 * the DORMANT_BATCH Action Center detector). The discriminator is kept open
 * so future segment kinds (birthday, lapsed-payment, NPS-promoter) slot in
 * without breaking existing payloads.
 */
import { z } from "zod";

export const DormantBucketEnum = z.enum(["90-180", "180-365", "365+"]);
export type DormantBucket = z.infer<typeof DormantBucketEnum>;

// "SMS" was dropped in Wave 3 of `docs/TZ-sms-removal.md`; campaigns
// are TG-only now. Legacy Campaign rows with channel="SMS" stay in
// the DB until the Wave 5 schema migration — the launcher refuses
// to send them (the Prisma `channel` column still permits the value).
export const CampaignChannelEnum = z.enum(["TG"]);
export type CampaignChannel = z.infer<typeof CampaignChannelEnum>;

export const DormantSegmentSchema = z.object({
  kind: z.literal("dormant"),
  bucket: DormantBucketEnum,
});

export const CampaignSegmentSchema = DormantSegmentSchema;
export type CampaignSegment = z.infer<typeof CampaignSegmentSchema>;

export const CreateCampaignSchema = z.object({
  name: z.string().min(2).max(200),
  channel: CampaignChannelEnum,
  templateId: z.string().min(1),
  segment: CampaignSegmentSchema,
});
export type CreateCampaign = z.infer<typeof CreateCampaignSchema>;

export const LaunchCampaignSchema = z.object({
  /** Optional Action Center action id to close on successful launch. */
  sourceActionId: z.string().min(1).optional().nullable(),
});
export type LaunchCampaign = z.infer<typeof LaunchCampaignSchema>;

export const QueryCampaignsSchema = z.object({
  status: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
