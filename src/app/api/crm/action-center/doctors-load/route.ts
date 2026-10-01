/**
 * GET /api/crm/action-center/doctors-load — «Загрузка врачей на сегодня»
 * (audit AC-15): each doctor's booked minutes against the working time the
 * schedule gives them today. See `src/server/actions/doctors-load.ts`.
 *
 * RBAC: the Action Center's roles.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ACTION_READER_ROLES } from "@/lib/actions/roles";
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { loadDoctorsLoad } from "@/server/actions/doctors-load";

export const GET = createApiListHandler(
  { roles: [...ACTION_READER_ROLES] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    return ok({ rows: await loadDoctorsLoad(prisma) });
  },
);
