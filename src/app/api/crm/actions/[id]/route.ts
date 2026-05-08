/**
 * /api/crm/actions/[id] — fetch one action row.
 *
 * Tenant scope auto-applies via the Prisma extension. Mutations live in
 * sibling routes (`./snooze`, `./dismiss`, `./done`, `./reopen`).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, notFound, err } from "@/server/http";

function idFromUrl(request: Request): string {
  // /.../actions/[id]
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.action.findUnique({ where: { id } });
    if (!row) return notFound();
    return ok(row);
  },
);

export const PATCH = () => err("Method Not Allowed", 405);
export const DELETE = () => err("Method Not Allowed", 405);
