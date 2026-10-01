import { z } from "zod";

import { TashkentDaySchema } from "./common";

export const QueryAuditSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
  // Events about one patient: the card's own rows and every row whose meta
  // names the patient (audit G1-10).
  patientId: z.string().optional(),
  // Tashkent calendar days, both inclusive (see `tashkentDayRange`).
  from: TashkentDaySchema.optional(),
  to: TashkentDaySchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type QueryAudit = z.infer<typeof QueryAuditSchema>;
