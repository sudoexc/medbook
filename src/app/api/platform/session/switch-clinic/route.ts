/**
 * POST /api/platform/session/switch-clinic — set / clear the SUPER_ADMIN
 * clinic-override cookie.
 *
 * Body: `{ clinicId: string | null }`. When `null`, the cookie is cleared
 * and the SUPER_ADMIN returns to the global (no-tenant) view.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import {
  OVERRIDE_COOKIE_NAME,
  signClinicOverride,
} from "@/server/platform/clinic-override";
import { SwitchClinicSchema } from "@/server/schemas/platform";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "SUPER_ADMIN") return err("Forbidden", 403);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = SwitchClinicSchema.safeParse(raw);
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }

  const clinicId = parsed.data.clinicId;
  return runWithTenant(
    { kind: "SUPER_ADMIN", userId: session.user.id },
    async () => {
      if (clinicId) {
        const exists = await prisma.clinic.findUnique({
          where: { id: clinicId },
          select: { id: true, slug: true, nameRu: true },
        });
        if (!exists) return notFound();

        const signed = signClinicOverride(clinicId);
        await platformAudit({
          request,
          userId: session.user.id,
          clinicId,
          action: "session.switch_clinic",
          entityType: "Session",
          meta: { clinicId, slug: exists.slug },
        });

        const headers = new Headers();
        headers.append(
          "set-cookie",
          [
            `${OVERRIDE_COOKIE_NAME}=${signed}`,
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            process.env.NODE_ENV === "production" ? "Secure" : "",
            `Max-Age=${60 * 60 * 12}`, // 12h
          ]
            .filter(Boolean)
            .join("; "),
        );
        return Response.json(
          { ok: true, clinicId: exists.id, slug: exists.slug, nameRu: exists.nameRu },
          { status: 200, headers },
        );
      }

      await platformAudit({
        request,
        userId: session.user.id,
        clinicId: null,
        action: "session.clear_clinic",
        entityType: "Session",
      });
      const headers = new Headers();
      headers.append(
        "set-cookie",
        [
          `${OVERRIDE_COOKIE_NAME}=`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          process.env.NODE_ENV === "production" ? "Secure" : "",
          "Max-Age=0",
        ]
          .filter(Boolean)
          .join("; "),
      );
      return Response.json({ ok: true, clinicId: null }, { status: 200, headers });
    },
  );
}

export async function GET(): Promise<Response> {
  return err("MethodNotAllowed", 405);
}

void ok; // keep import narrow; ok unused here
