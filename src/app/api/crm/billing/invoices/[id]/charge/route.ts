/**
 * POST /api/crm/billing/invoices/[id]/charge — initiate a real payment.
 *
 * Body: `{ provider: "click" | "payme" }`
 *
 * Responsibilities:
 *   1. Load the invoice, verify it belongs to the caller's clinic and is
 *      not already PAID/VOID.
 *   2. Call the matching `*CreateCharge` adapter, which builds the real
 *      provider checkout URL when credentials are present, or returns
 *      the in-app stub URL when they're not.
 *   3. Audit the user-initiated charge so support can correlate "user
 *      clicked Pay via Click at 14:02" with the eventual webhook.
 *   4. Return `{ payUrl, isStub, provider }` so the client can redirect
 *      (real mode) or call the simulate endpoint (stub mode).
 *
 * The webhook side (`/api/webhooks/billing/{click,payme}`) is what
 * eventually flips the invoice to PAID — this endpoint never mutates
 * state.
 */
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { err, ok } from "@/server/http";
import { clickCreateCharge } from "@/server/billing/payments/click";
import { paymeCreateCharge } from "@/server/billing/payments/payme";

export const runtime = "nodejs";

const BodySchema = z.object({
  provider: z.enum(["click", "payme"]),
});

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../invoices/[id]/charge
  return parts[parts.length - 2] ?? "";
}

function resolveLocaleFromRequest(request: Request): "ru" | "uz" {
  const url = new URL(request.url);
  const q = url.searchParams.get("locale");
  if (q === "uz" || q === "ru") return q;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const p = new URL(referer).pathname;
      if (p.startsWith("/uz/") || p === "/uz") return "uz";
    } catch {
      // ignore — fall through to default
    }
  }
  return "ru";
}

function buildReturnUrl(request: Request, locale: "ru" | "uz"): string {
  // Prefer the public base URL (set in prod) so the redirect target is
  // the real `https://neurofax.uz/...` even when the API is called from
  // an SSR runtime that sees an internal hostname.
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
    new URL(request.url).origin;
  return `${base}/${locale}/crm/settings/billing`;
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (e) {
    return err("ValidationError", 400, {
      issues: (e as { issues?: unknown }).issues,
    });
  }

  const id = idFromUrl(request);
  if (!id) return err("InvalidInvoiceId", 400);

  const locale = resolveLocaleFromRequest(request);
  const returnUrl = buildReturnUrl(request, locale);

  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  return runWithTenant(ctx, async () => {
    const invoice = await prisma.invoice.findFirst({
      where: { id, clinicId: ctx.clinicId as string },
      select: {
        id: true,
        number: true,
        status: true,
        amountTiins: true,
      },
    });
    if (!invoice) return err("InvoiceNotFound", 404);
    if (invoice.status === "PAID") return err("AlreadyPaid", 409);
    if (invoice.status === "VOID") return err("InvoiceVoided", 409);

    const charge =
      parsed.provider === "click"
        ? await clickCreateCharge({
            invoice: {
              id: invoice.id,
              number: invoice.number,
              amountTiins: invoice.amountTiins,
            },
            returnUrl,
            locale,
          })
        : await paymeCreateCharge({
            invoice: {
              id: invoice.id,
              number: invoice.number,
              amountTiins: invoice.amountTiins,
            },
            returnUrl,
            locale,
          });

    try {
      await prisma.auditLog.create({
        data: {
          clinicId: ctx.clinicId as string,
          actorId: ctx.userId ?? null,
          actorRole: ctx.role ?? null,
          action: "billing.charge.initiated",
          entityType: "Invoice",
          entityId: invoice.id,
          meta: {
            number: invoice.number,
            provider: parsed.provider,
            amountTiins: invoice.amountTiins.toString(),
            isStub: charge.isStub,
            providerRef: charge.providerRef,
          },
        },
      });
    } catch (auditErr) {
      console.warn("[billing.charge] audit failed", auditErr);
    }

    return ok({
      provider: parsed.provider,
      payUrl: charge.payUrl,
      providerRef: charge.providerRef,
      isStub: charge.isStub,
    });
  });
}
