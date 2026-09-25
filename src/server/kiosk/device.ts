/**
 * The lobby kiosk as an authenticated device (audit SEC-01).
 *
 * The kiosk APIs used to trust «the slug is the bearer» — but the slug is
 * public (landing, Mini App), so anyone on the internet could look a patient
 * up by phone (full name, visits) and put people into the live queue. Now
 * the tablet holds a device token:
 *
 *   - the ADMIN creates it in CRM → Настройки → Клиника → «Киоск», which
 *     shows the kiosk link once (…/kiosk?k=<token>);
 *   - the tablet opens that link once; the page keeps the token and sends it
 *     as `x-kiosk-token` with every call;
 *   - only its sha256 is stored (Clinic.kioskTokenHash), so a database read
 *     does not hand out a working kiosk; issuing a new one revokes the old.
 *
 * Even an authenticated kiosk only ever shows a masked name («Юсупова Л.»)
 * and never a phone: whoever stands at the tablet is not necessarily the
 * patient whose number they typed.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { prisma } from "@/lib/prisma";

export const KIOSK_TOKEN_HEADER = "x-kiosk-token";

export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A fresh device token and the hash to store. */
export function issueKioskToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashKioskToken(token) };
}

export type KioskDevice = { clinicId: string; clinicSlug: string };

/**
 * The clinic whose kiosk sent this request, or null. When `slug` is given
 * (the /api/c/[slug]/… routes) the token must belong to THAT clinic.
 */
export async function authenticateKiosk(
  request: Request,
  slug?: string | null,
): Promise<KioskDevice | null> {
  const token = request.headers.get(KIOSK_TOKEN_HEADER)?.trim();
  if (!token || token.length < 16 || token.length > 128) return null;
  const hash = hashKioskToken(token);
  const clinic = await prisma.clinic.findUnique({
    where: { kioskTokenHash: hash },
    select: { id: true, slug: true, active: true, kioskTokenHash: true },
  });
  if (!clinic || !clinic.active || !clinic.kioskTokenHash) return null;
  // Belt and braces: the unique lookup already matched, compare anyway.
  const a = Buffer.from(clinic.kioskTokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (slug && clinic.slug !== slug) return null;
  return { clinicId: clinic.id, clinicSlug: clinic.slug };
}

export function kioskUnauthorized(): Response {
  return Response.json(
    { error: "Unauthorized", reason: "kiosk_not_paired" },
    { status: 401 },
  );
}

/** A valid token of another clinic: refuse, but do not unpair the tablet. */
export function kioskWrongClinic(): Response {
  return Response.json(
    { error: "Forbidden", reason: "kiosk_wrong_clinic" },
    { status: 403 },
  );
}

/**
 * For the /api/c/[slug]/… kiosk routes: 401 when the tablet is not paired,
 * 403 when it is paired to a different clinic than the URL names.
 */
export async function requireKioskFor(
  request: Request,
  slug: string,
): Promise<{ ok: true; device: KioskDevice } | { ok: false; response: Response }> {
  const device = await authenticateKiosk(request);
  if (!device) return { ok: false, response: kioskUnauthorized() };
  if (device.clinicSlug !== slug) return { ok: false, response: kioskWrongClinic() };
  return { ok: true, device };
}

/**
 * The caller's address as nginx saw it. `X-Real-IP` is set by our proxy from
 * the TCP peer; the first `X-Forwarded-For` entry is whatever the client
 * wrote, so a rate limit keyed on it is bypassed by changing a header. Shared
 * with the auth and audit code, so it lives in `@/lib/client-ip`.
 */
export { realClientIp } from "@/lib/client-ip";

/** «Юсупова Лола Анваровна» → «Юсупова Л.» — enough to confirm, not to harvest. */
export function maskPatientName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const [surname, ...rest] = parts;
  const initials = rest
    .slice(0, 2)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join("");
  return initials ? `${surname} ${initials}` : surname!;
}
