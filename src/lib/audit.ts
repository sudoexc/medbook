import { prisma } from "./prisma";
import { auth } from "./auth";
import { hasValidPin } from "./pin";

/**
 * Fire-and-forget audit log. Failures are logged to console but never throw —
 * we don't want a dead audit table to break patient-facing flows. If audit
 * logging becomes critical (e.g. for compliance), promote this to a hard
 * dependency at that point.
 */
interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
}

function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}

export async function audit(request: Request, input: AuditInput): Promise<void> {
  try {
    const session = await auth();
    const viaPin = !session?.user && hasValidPin(request);
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        meta: (input.meta ?? null) as never,
        actorId: session?.user?.id ?? null,
        actorRole: session?.user?.role ?? (viaPin ? "TERMINAL" : null),
        actorLabel: session?.user?.email ?? (viaPin ? "terminal" : null),
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    console.error("[audit]", err);
  }
}
