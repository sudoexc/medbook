/**
 * Legacy single-tenant Telegram webhook — DEPRECATED.
 *
 * Replaced by the per-clinic webhook at
 *   /api/telegram/webhook/[clinicSlug]/route.ts
 * which is the target of `setWebhook` from the integrations wizard.
 *
 * The legacy handler had `@ts-nocheck`, used a non-canonical phone
 * normalizer, and looked up patients by `phone` without `clinicId`
 * scoping — a cross-tenant data risk. We hard-disable it here.
 */

export async function POST() {
  return new Response(
    JSON.stringify({
      error: "Gone",
      reason: "legacy_webhook_removed",
      hint: "Configure setWebhook to /api/telegram/webhook/{clinicSlug}",
    }),
    { status: 410, headers: { "content-type": "application/json" } },
  );
}

export async function GET() {
  return new Response(null, { status: 410 });
}
