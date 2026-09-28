import QRCode from "qrcode";
import { createTranslator } from "next-intl";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant-context";
import { SITE_DOMAIN } from "@/lib/constants";
import {
  formatClinicDateTime,
  formatDate,
  formatPhone,
  initials,
  type Locale,
} from "@/lib/format";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { isLiveLane } from "@/lib/queue-ordering";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import {
  queueTicketToken,
  resolveTicketStubRequest,
  ticketStubVerdict,
} from "@/server/appointments/public-ticket";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import { AutoPrint } from "./_components/auto-print";

/**
 * This route lives outside the [locale] segment (the kiosk and the front
 * desk open the bare /ticket/<ref>), so no next-intl provider reaches it: the
 * stub builds its own translator in the patient's language.
 */
function ticketTranslator(locale: Locale) {
  return createTranslator({
    locale,
    messages: locale === "uz" ? uz : ru,
    namespace: "ticketStub",
  });
}

type RefusalReason = "not_found" | "staff_only" | "expired" | "not_today";

/**
 * A stub that shows nothing. Said in both languages: before the lookup the
 * patient is unknown, and after a refused one her language is not ours to
 * reveal either.
 */
function TicketRefusal({ reason }: { reason: RefusalReason }) {
  const keys = {
    not_found: ["notFound", null],
    staff_only: ["staffOnly", "staffOnlyHint"],
    expired: ["linkExpired", "linkExpiredHint"],
    not_today: ["linkNotToday", "linkNotTodayHint"],
  } as const;
  const [title, hint] = keys[reason];
  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "Arial, sans-serif" }}>
      {(["ru", "uz"] as const).map((locale) => {
        const t = ticketTranslator(locale);
        return (
          <div key={locale} style={{ marginBottom: 16 }}>
            <p style={{ fontWeight: "bold", margin: 0 }}>{t(title)}</p>
            {hint ? <p style={{ color: "#666", margin: "4px 0 0" }}>{t(hint)}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** The signed-in staff member's clinic, or null (no session, no clinic). */
async function staffClinicId(): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.clinicId ?? null;
  } catch {
    return null;
  }
}

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: ref } = await params;

  // Audit INF-10: a bare appointment id is not a key to this page any more.
  // The front desk prints with its staff session, the kiosk with the signed
  // ticket token of its walk-in / check-in answer; anything else is refused
  // before the lookup. See resolveTicketStubRequest.
  const request = await resolveTicketStubRequest(ref, staffClinicId);
  if (request.kind === "refuse") return <TicketRefusal reason={request.reason} />;
  const appointmentId = request.appointmentId;

  // Public page: the patient name is masked to initials (mirrors
  // /api/queue/status), and only the fields the printed stub needs are
  // selected. The clinic is unknown until the row resolves, so the lookup
  // runs with an explicit unscoped bypass (fail-closed Prisma extension);
  // the staff session's clinic or the signed token is the authorization,
  // checked right after by ticketStubVerdict.
  const appointment = await runUnscoped(
    "public ticket stub: lookup appointment by staff session or signed ticket token",
    () =>
      prisma.appointment.findUnique({
        where: { id: appointmentId },
        select: {
          queueOrder: true,
          ticketSeq: true,
          clinicId: true,
          date: true,
          time: true,
          channel: true,
          doctorId: true,
          patient: { select: { fullName: true, preferredLang: true } },
          doctor: {
            select: {
              id: true,
              nameRu: true,
              nameUz: true,
              ticketPrefix: true,
              cabinet: { select: { number: true } },
            },
          },
          primaryService: { select: { nameRu: true, nameUz: true } },
          // Header and footer come from the clinic's own settings (audit
          // Q-11): the stub used to print «NEUROFAX-B» and a phone number
          // that matched no clinic, for every clinic on the platform.
          clinic: {
            select: {
              nameRu: true,
              nameUz: true,
              phone: true,
              addressRu: true,
              addressUz: true,
            },
          },
        },
      }),
  );

  const verdict = ticketStubVerdict(request, appointment);
  if (!verdict.ok || !appointment) {
    return <TicketRefusal reason={verdict.ok ? "not_found" : verdict.reason} />;
  }

  const locale: Locale = appointment.patient.preferredLang === "UZ" ? "uz" : "ru";
  const t = ticketTranslator(locale);
  const pick = (ruText: string | null, uzText: string | null) =>
    (locale === "uz" ? uzText?.trim() || ruText : ruText?.trim() || uzText) ?? "";
  const clinicName = pick(appointment.clinic.nameRu, appointment.clinic.nameUz);
  const clinicAddress = pick(
    appointment.clinic.addressRu,
    appointment.clinic.addressUz,
  );
  const clinicPhone = formatPhone(appointment.clinic.phone);
  const doctorName = pick(appointment.doctor.nameRu, appointment.doctor.nameUz);
  const serviceName = verdict.showService && appointment.primaryService
    ? pick(appointment.primaryService.nameRu, appointment.primaryService.nameUz)
    : "";
  const cabinet = appointment.doctor.cabinet?.number ?? null;

  // Nullable under two-lanes: a booking printed before check-in has no queue
  // fields — the stub leads with its slot time instead of a fake "C-000".
  // ticketSeq is the printed number; queueOrder moves with drag-reorders and
  // with cancellations, so reprinting from it could show someone else's ticket.
  const ticketNumber = ticketNumberFor(
    appointment.doctor,
    appointment.ticketSeq ?? appointment.queueOrder,
  );
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${SITE_DOMAIN}`;
  // The QR carries a signed ticket token, never the bare id (audit INF-10):
  // the id is no longer a key to the queue status, the token is, and the
  // status page answers it on the appointment's own day only.
  const statusUrl = `${baseUrl}/q/${queueTicketToken(appointmentId)}`;
  // Self-hosted QR (the `qrcode` package, same one the PDFs/mini-app use) —
  // no third-party `api.qrserver.com` round-trip, which both leaks the queue
  // URL and is unreliable from a VPS behind SNI/DPI filtering.
  const qrUrl = await QRCode.toDataURL(statusUrl, { width: 200, margin: 1 });
  // Clinic wall-clock (audit Q-11): this is a server component and the server
  // runs UTC, so the bare toLocale*String printed a 09:15 walk-in as 04:15.
  const issuedAt = formatClinicDateTime(appointment.date, locale);
  const timeStr = formatDate(appointment.date, locale, "time");

  // Two-lanes (docs/TZ-two-lanes.md): only a walk-in has a queue position.
  // A booking's stub shows its slot time instead of «перед вами». Position
  // comes from the SAME projection as the QR page and boards — a private
  // count here would disagree the moment a «срочно» bump exists.
  const live = isLiveLane(appointment);
  let waitingAhead: number | null = null;
  if (live) {
    // Same unscoped rationale as the lookup above — the projection reads
    // queue rows for the clinic this (already-authorized) ticket belongs to.
    const projection = await runUnscoped(
      "public ticket stub: queue projection for the resolved clinic",
      () =>
        getQueueProjection({
          clinicId: appointment.clinicId,
          doctorIds: [appointment.doctorId],
        }),
    );
    const mine = projection
      .get(appointment.doctorId)
      ?.waiting.find((w) => w.appointmentId === appointmentId);
    waitingAhead = mine ? mine.position - 1 : 0;
  }

  return (
    <div
      style={{
        width: "80mm",
        minHeight: "120mm",
        margin: "0 auto",
        padding: "5mm",
        fontFamily: "Arial, sans-serif",
        fontSize: "12px",
        color: "#000",
        background: "#fff",
      }}
    >
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          @page { size: 80mm auto; margin: 2mm; }
        }
        @media screen {
          body { background: #f0f0f0; }
        }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
        <div style={{ fontSize: "16px", fontWeight: "bold", letterSpacing: "1px" }}>{clinicName}</div>
        {clinicAddress ? (
          <div style={{ fontSize: "9px", color: "#666", marginTop: "1mm" }}>{clinicAddress}</div>
        ) : null}
      </div>

      {/* Ticket number — BIG */}
      <div style={{ textAlign: "center", margin: "4mm 0" }}>
        <div style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "2px" }}>{ticketNumber ? t("yourNumber") : t("yourTime")}</div>
        <div style={{ fontSize: "48px", fontWeight: "bold", lineHeight: "1.1", letterSpacing: "2px" }}>{ticketNumber ?? appointment.time ?? timeStr}</div>
      </div>

      {/* Separator */}
      <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

      {/* Details */}
      <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("patient")}</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{initials(appointment.patient.fullName)}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("doctor")}</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{doctorName}</td>
          </tr>
          {cabinet ? (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("cabinet")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold", fontSize: "14px" }}>{cabinet}</td>
            </tr>
          ) : null}
          {serviceName ? (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("service")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{serviceName}</td>
            </tr>
          ) : null}
          <tr>
            <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("date")}</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{issuedAt}</td>
          </tr>
          {waitingAhead !== null ? (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("ahead")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{t("aheadCount", { count: waitingAhead })}</td>
            </tr>
          ) : (
            <tr>
              <td style={{ padding: "1.5mm 0", color: "#666" }}>{t("booked")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{appointment.time ?? timeStr}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Separator */}
      <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

      {/* QR Code */}
      <div style={{ textAlign: "center", margin: "3mm 0" }}>
        <img
          src={qrUrl}
          alt="QR"
          width={140}
          height={140}
          style={{ display: "inline-block" }}
        />
        <div style={{ fontSize: "8px", color: "#999", marginTop: "1.5mm" }}>
          {t("scan")}
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", borderTop: "1px dashed #000", paddingTop: "3mm", marginTop: "3mm" }}>
        <div style={{ fontSize: "9px", color: "#666" }}>{t("thanks")}</div>
        {clinicPhone ? (
          <div style={{ fontSize: "8px", color: "#999", marginTop: "1mm" }}>{clinicPhone}</div>
        ) : null}
      </div>

      <AutoPrint />
    </div>
  );
}
