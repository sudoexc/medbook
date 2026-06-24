/**
 * /api/crm/conversations/assignees — operators a conversation can be assigned
 * to. Readable by all inbox roles so any operator can hand a thread off.
 *
 * User lives in MODELS_WITHOUT_TENANT, so we filter by `ctx.clinicId` manually.
 */
import type { Role } from "@/generated/prisma/client";
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

const ASSIGNABLE_ROLES: Role[] = [
  "ADMIN",
  "RECEPTIONIST",
  "CALL_OPERATOR",
  "DOCTOR",
  "NURSE",
];

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const rows = await prisma.user.findMany({
      where: {
        clinicId: ctx.clinicId,
        active: true,
        role: { in: ASSIGNABLE_ROLES },
      },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
    return ok({ rows });
  }
);
