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
import { mintOrReuseInviteUrl } from "@/server/telegram/invite-token";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: ref } = await params;
  // The kiosk passes the language the patient chose on its screen (UX-06):
  // a booked patient checking in in Uzbek gets an Uzbek stub even when the
  // card still says Russian.
  const rawLang = (await searchParams)?.lang;
  const chosenLang = Array.isArray(rawLang) ? rawLang[0] : rawLang;

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
          patientId: true,
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
              tgBotUsername: true,
            },
          },
        },
      }),
  );

  const verdict = ticketStubVerdict(request, appointment);
  if (!verdict.ok || !appointment) {
    return <TicketRefusal reason={verdict.ok ? "not_found" : verdict.reason} />;
  }

  const locale: Locale =
    chosenLang === "uz" || chosenLang === "ru"
      ? chosenLang
      : appointment.patient.preferredLang === "UZ"
        ? "uz"
        : "ru";
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
  // status page answers it on the appointment's own day only. The page
  // opens in the stub's language (UX-06).
  const statusUrl = `${baseUrl}/q/${queueTicketToken(appointmentId)}?lang=${locale}`;
  // The QR leads to the clinic's Telegram bot (owner request 09.10.2026):
  // the patient scans it in the hall and the doctor's conclusion and
  // prescriptions reach their Telegram. A patient not linked yet gets the
  // invite deep link the conclusion prints too (mintOrReuseInviteUrl: it
  // links nothing until Telegram vouches for the card's own phone, so a
  // slip left behind links no stranger); a linked one gets the bot itself.
  // A clinic without a bot keeps the queue status link.
  const botUsername = appointment.clinic.tgBotUsername;
  const invite = botUsername
    ? await runUnscoped(
        "public ticket stub: Telegram invite for the resolved patient",
        () =>
          mintOrReuseInviteUrl({ patientId: appointment.patientId, createdByUserId: null }),
      ).catch(() => null)
    : null;
  const botUrl = botUsername ? (invite?.url ?? `https://t.me/${botUsername}`) : null;
  // Self-hosted QR (the `qrcode` package, same one the PDFs/mini-app use) —
  // no third-party `api.qrserver.com` round-trip, which both leaks the URL
  // and is unreliable from a VPS behind SNI/DPI filtering.
  const qrUrl = await QRCode.toDataURL(botUrl ?? statusUrl, { width: 200, margin: 1 });
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
      // Sized for the 80mm thermal printer at the desk (Xprinter XP-80,
      // owner report 08.10.2026: the small lines were hard to read). Its
      // printable band is 72mm: the old 80mm box plus padding and page
      // margins was wider, so Chrome shrank the whole slip to fit. And a
      // thermal head prints grey as sparse dots, so every line is black and
      // the smallest text is 13px.
      style={{
        width: "72mm",
        boxSizing: "border-box",
        margin: "0 auto",
        padding: "2mm 1mm 4mm",
        fontFamily: "Arial, sans-serif",
        fontSize: "15px",
        color: "#000",
        background: "#fff",
      }}
    >
      <style>{`
        @media print {
          body { margin: 0; padding: 0; }
          @page { size: 80mm auto; margin: 0; }
        }
        @media screen {
          body { background: #f0f0f0; }
        }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "3mm", marginBottom: "3mm" }}>
        <div style={{ fontSize: "22px", fontWeight: "bold", letterSpacing: "1px" }}>{clinicName}</div>
        {clinicAddress ? (
          <div style={{ fontSize: "13px", marginTop: "1mm" }}>{clinicAddress}</div>
        ) : null}
      </div>

      {/* Ticket number — BIG */}
      <div style={{ textAlign: "center", margin: "4mm 0" }}>
        <div style={{ fontSize: "15px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "2px" }}>{ticketNumber ? t("yourNumber") : t("yourTime")}</div>
        <div style={{ fontSize: "64px", fontWeight: "bold", lineHeight: "1.1", letterSpacing: "2px" }}>{ticketNumber ?? appointment.time ?? timeStr}</div>
      </div>

      {/* Separator */}
      <div style={{ borderTop: "1px dashed #000", margin: "3mm 0" }} />

      {/* Details */}
      <table style={{ width: "100%", fontSize: "16px", borderCollapse: "collapse" }}>
        <tbody>
          <tr>
            <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("patient")}</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{initials(appointment.patient.fullName)}</td>
          </tr>
          <tr>
            <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("doctor")}</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{doctorName}</td>
          </tr>
          {cabinet ? (
            <tr>
              <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("cabinet")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold", fontSize: "20px" }}>{cabinet}</td>
            </tr>
          ) : null}
          {serviceName ? (
            <tr>
              <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("service")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{serviceName}</td>
            </tr>
          ) : null}
          <tr>
            <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("date")}</td>
            <td style={{ padding: "1.5mm 0", textAlign: "right" }}>{issuedAt}</td>
          </tr>
          {waitingAhead !== null ? (
            <tr>
              <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("ahead")}</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: "bold" }}>{t("aheadCount", { count: waitingAhead })}</td>
            </tr>
          ) : (
            <tr>
              <td style={{ padding: "1.5mm 3mm 1.5mm 0", whiteSpace: "nowrap" }}>{t("booked")}</td>
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
          width={150}
          height={150}
          style={{ display: "inline-block" }}
        />
        {botUrl ? (
          <>
            <div style={{ fontSize: "17px", fontWeight: "bold", marginTop: "1.5mm" }}>
              {t("botTitle")}
            </div>
            <div style={{ fontSize: "13px", marginTop: "1mm" }}>{t("botScan")}</div>
          </>
        ) : (
          <div style={{ fontSize: "13px", marginTop: "1.5mm" }}>{t("scan")}</div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", borderTop: "1px dashed #000", paddingTop: "3mm", marginTop: "3mm" }}>
        <div style={{ fontSize: "14px" }}>{t("thanks")}</div>
        {clinicPhone ? (
          <div style={{ fontSize: "15px", fontWeight: "bold", marginTop: "1mm" }}>{clinicPhone}</div>
        ) : null}
      </div>

      <AutoPrint />
    </div>
  );
}
