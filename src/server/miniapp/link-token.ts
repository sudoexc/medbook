/**
 * Short-lived, single-purpose links for the Mini App (audit MA-07).
 *
 * Telegram's initData is the patient's whole account for 24 hours: every
 * `/api/miniapp/*` endpoint accepts it, including cancelling visits, adding
 * relatives and deleting the account. It used to travel in URL query strings
 * wherever a header could not be set (the SSE stream, document and
 * conclusion links, the calendar file), so it landed in nginx's access log
 * and in «links» a patient forwarded from the external browser.
 *
 * initData is now accepted from the `X-Telegram-Init-Data` header only, and
 * those three places carry one of these instead: an HMAC-signed statement
 * «patient P of clinic C may read resource R of kind S until E». It opens
 * that one thing, for minutes, and nothing else.
 *
 * They are not single-use: a PDF viewer re-requests the same URL, and
 * Android hands a download to its download manager, which fetches it again.
 * The short lifetime and the one-resource scope are what bound a leak.
 */
import { appHmac, appHmacMatches } from "@/server/crypto/app-hmac";

const PURPOSE = "miniapp-link-v1";

export type MiniAppLinkScope = "doc" | "ics" | "events";

/** How long each kind of link opens its resource. */
export const MINIAPP_LINK_TTL_MS: Record<MiniAppLinkScope, number> = {
  // Minted into the documents / visits lists; the list is refetched every
  // time the patient returns to the app, so the link in hand stays fresh.
  doc: 15 * 60 * 1000,
  // Minted when the patient taps «add to calendar».
  ics: 5 * 60 * 1000,
  // Only has to open the stream; an open stream is not cut when it expires.
  events: 2 * 60 * 1000,
};

export type MiniAppLinkClaims = {
  scope: MiniAppLinkScope;
  clinicId: string;
  /** The patient the resource belongs to (the acting patient for ics). */
  patientId: string;
  /** Document id, appointment id, or the patient id for the event stream. */
  resourceId: string;
  expiresAt: number;
};

type Wire = { s: MiniAppLinkScope; c: string; p: string; r: string; e: number };

export function mintMiniAppLink(
  claims: Omit<MiniAppLinkClaims, "expiresAt">,
  now: number = Date.now(),
): string {
  const wire: Wire = {
    s: claims.scope,
    c: claims.clinicId,
    p: claims.patientId,
    r: claims.resourceId,
    e: now + MINIAPP_LINK_TTL_MS[claims.scope],
  };
  const body = Buffer.from(JSON.stringify(wire)).toString("base64url");
  return `${body}.${appHmac(PURPOSE, body)}`;
}

/**
 * The claims of a valid, unexpired link of `scope` for `resourceId`, or null.
 * Checking the scope and the resource here means a document link can never
 * open the event stream, and a link for one document never opens another.
 */
export function verifyMiniAppLink(
  token: string | null | undefined,
  expect: { scope: MiniAppLinkScope; resourceId?: string },
  now: number = Date.now(),
): MiniAppLinkClaims | null {
  if (!token || token.length > 1024) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  if (!appHmacMatches(PURPOSE, body, token.slice(dot + 1))) return null;
  let wire: Partial<Wire>;
  try {
    wire = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<Wire>;
  } catch {
    return null;
  }
  if (
    wire.s !== expect.scope ||
    typeof wire.c !== "string" ||
    typeof wire.p !== "string" ||
    typeof wire.r !== "string" ||
    typeof wire.e !== "number" ||
    wire.e < now
  ) {
    return null;
  }
  if (expect.resourceId !== undefined && wire.r !== expect.resourceId) return null;
  return {
    scope: wire.s,
    clinicId: wire.c,
    patientId: wire.p,
    resourceId: wire.r,
    expiresAt: wire.e,
  };
}

/**
 * The Mini App URL of one document's bytes, carrying a link for exactly that
 * document of that patient (never initData).
 */
export function miniAppDocumentUrl(args: {
  clinicId: string;
  clinicSlug: string;
  patientId: string;
  documentId: string;
}): string {
  const token = mintMiniAppLink({
    scope: "doc",
    clinicId: args.clinicId,
    patientId: args.patientId,
    resourceId: args.documentId,
  });
  return `/api/miniapp/documents/${encodeURIComponent(args.documentId)}/file?clinicSlug=${encodeURIComponent(args.clinicSlug)}&t=${encodeURIComponent(token)}`;
}
