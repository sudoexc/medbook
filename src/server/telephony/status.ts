/**
 * Is the clinic's telephony really connected? (audit UX-08)
 *
 * No PBX adapter exists yet: `resolveTelephonyForClinic` always answers
 * LogOnly, and the SIP webhook (`/api/calls/sip/event`) only accepts events
 * signed with `config.webhookSecret` of an active `OTHER / "sip"`
 * connection, a field the settings card never writes. Still, reception
 * always showed a «Call Center / Нет активных звонков» widget, and the
 * settings card turned green «Подключено» as soon as a server, a login and
 * a password were saved. The desk lost room to a widget that could never
 * ring, and the admin believed calls were coming in.
 *
 * Connected means proven: the webhook can accept events (the connection
 * is active and has its webhook secret) AND at least one event arrived
 * (a call row carrying a provider call id; the LogOnly adapter's own
 * "log-…" ids do not count). Until then the widget stays hidden and the
 * card says «Не подключено».
 */
import type { prisma as prismaClient } from "@/lib/prisma";

/** Prefix of the call ids the LogOnly adapter makes up for itself. */
export const LOG_ONLY_CALL_ID_PREFIX = "log-";

export interface TelephonyStatus {
  /** Events can arrive and have arrived. */
  connected: boolean;
  /** An active SIP connection is saved (the settings card has something). */
  configured: boolean;
  /** The webhook can accept events (the secret is set). */
  webhookReady: boolean;
  /** When the last provider event created a call row. */
  lastEventAt: string | null;
}

/** Pure: the verdict from what the database holds. */
export function telephonyStatusFrom(input: {
  connection: { active: boolean; config: unknown } | null;
  lastProviderCallAt: Date | null;
}): TelephonyStatus {
  const cfg = input.connection?.config;
  const secret =
    cfg && typeof cfg === "object" && !Array.isArray(cfg)
      ? (cfg as Record<string, unknown>).webhookSecret
      : null;
  const configured = Boolean(input.connection?.active);
  const webhookReady = configured && typeof secret === "string" && secret.length > 0;
  return {
    connected: webhookReady && input.lastProviderCallAt !== null,
    configured,
    webhookReady,
    lastEventAt: input.lastProviderCallAt?.toISOString() ?? null,
  };
}

type Db = Pick<typeof prismaClient, "providerConnection" | "call">;

/** Two small reads; every query pins `clinicId`. */
export async function loadTelephonyStatus(
  db: Db,
  clinicId: string,
): Promise<TelephonyStatus> {
  const [connection, lastCall] = await Promise.all([
    // The same row the webhook authenticates against (see sip/event).
    db.providerConnection.findFirst({
      where: { clinicId, active: true, kind: "OTHER", label: "sip" },
      select: { active: true, config: true },
    }),
    db.call.findFirst({
      where: {
        clinicId,
        sipCallId: { not: null },
        NOT: { sipCallId: { startsWith: LOG_ONLY_CALL_ID_PREFIX } },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  return telephonyStatusFrom({
    connection,
    lastProviderCallAt: lastCall?.createdAt ?? null,
  });
}
