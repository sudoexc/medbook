/**
 * POST /api/c/[slug]/queue/walkin
 *
 * Public kiosk endpoint: register a walk-in patient (no prior appointment),
 * place them at the back of the chosen doctor's live queue, and return the
 * ticket payload for printing.
 *
 * Body: { fullName, phone, doctorId, lang?, phoneOwner?, patientId?, serviceId? }
 *
 * `phoneOwner` is the patient's answer on the kiosk's «Это вы? И.И.» screen:
 * "same" keeps the visit on the number's owner, "other" registers a
 * different person who uses that number (audit Q-03). Without an answer a
 * name that does not match the owner comes back as 409, never merged.
 *
 * `patientId` is the card the person picked on the kiosk («Это вы?» or
 * «Кто пришёл?», audit P1D-02). It is honoured only when it is one of the
 * cards the typed number stands for (`findKioskCards`): the owner, a
 * relative on that number or one linked to it in the Mini App. That keeps
 * a relative's visit on his own card, which the owner's name and «same»
 * could not.
 *
 * `serviceId` is the service chosen on the kiosk (audit Q-06): stored on
 * the visit with this doctor's price for it.
 *
 * The queue insertion itself lives in `registerWalkin` (shared with the CRM
 * front-desk endpoint) so both surfaces allocate the slot identically.
 *
 * Answers only to the clinic's paired kiosk (`x-kiosk-token`, audit SEC-01):
 * the slug is public, and anyone could otherwise fill the live queue with
 * strangers — or learn a patient's full name by typing her phone.
 */
import { z } from "zod";

import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { runWithTenant } from "@/lib/tenant-context";
import { registerWalkin } from "@/server/appointments/walkin";
import {
  kioskPrintToken,
  queueTicketToken,
} from "@/server/appointments/public-ticket";
import { prisma } from "@/lib/prisma";
import { findKioskCards } from "@/server/kiosk/phone-cards";
import { rateLimit } from "@/lib/rate-limit";
import {
  maskPatientName,
  realClientIp,
  requireKioskFor,
} from "@/server/kiosk/device";

const Body = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(3).max(20),
  doctorId: z.string().min(1),
  lang: z.enum(["RU", "UZ"]).optional(),
  phoneOwner: z.enum(["same", "other"]).optional(),
  patientId: z.string().min(1).max(64).optional(),
  serviceId: z.string().min(1).max(64).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const kiosk = await requireKioskFor(request, ctx.clinicSlug);
  if (!kiosk.ok) return kiosk.response;
  if (!rateLimit(`kiosk-walkin:${ctx.clinicId}:${realClientIp(request)}`, 20)) {
    return err("too_many_requests", 429);
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return err("bad_body", 400);
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // A card picked on the kiosk must be one the typed number stands for.
    let picked: { id: string; confirmPhoneClaim: boolean } | null = null;
    if (parsed.patientId) {
      const card = (await findKioskCards(prisma, ctx.clinicId, parsed.phone)).find(
        (c) => c.id === parsed.patientId,
      );
      if (!card) return err("conflict", 409, { reason: "patient_not_on_phone" });
      // «That is me» on a Mini App claim makes the number hers, exactly as
      // the answer "same" does on the name path (PH-01).
      picked = { id: card.id, confirmPhoneClaim: card.relation === "claim" };
    }

    const result = await registerWalkin({
      clinicId: ctx.clinicId,
      doctorId: parsed.doctorId,
      patient: picked ?? {
        fullName: parsed.fullName,
        phone: parsed.phone,
        lang: parsed.lang,
        phoneOwner: parsed.phoneOwner,
      },
      serviceId: parsed.serviceId ?? null,
      // Q-08 — no ticket for a doctor on leave or outside his schedule.
      requireOnDuty: true,
    });

    if (!result.ok) {
      if (result.reason === "doctor_not_found") return err("doctor_not_found", 404);
      if (result.reason === "doctor_off_duty") {
        return err("conflict", 409, { reason: "doctor_off_duty" });
      }
      if (result.reason === "service_not_offered") {
        return err("conflict", 409, { reason: "service_not_offered" });
      }
      if (result.reason === "phone_owner_mismatch") {
        // Masked, as everywhere on the kiosk: typing a number must not
        // reveal whose it is.
        return err("conflict", 409, {
          reason: "phone_owner_mismatch",
          owner: { fullName: maskPatientName(result.owner.fullName) },
        });
      }
      return err(result.reason, 400);
    }

    // A second press on the kiosk reprints the ticket the patient already
    // holds (same number, same QR) instead of queueing them twice.
    return ok(
      {
        appointmentId: result.appointmentId,
        // The QR's signed token (audit INF-10): a bare id prints nothing
        // without a staff session.
        ticketToken: queueTicketToken(result.appointmentId),
        // What the kiosk actually prints with, in a frame on its own page
        // (audit Q-09): short-lived, and the slip it opens names the
        // service the patient chose (Q-06).
        printToken: kioskPrintToken(result.appointmentId),
        duplicate: result.duplicate,
        ticketCode: result.ticketCode,
        ticketNumber: result.ticketNumber,
        queueOrder: result.queueOrder,
        // The stored name of an EXISTING patient must not leak to whoever
        // typed her number: a masked form is enough for the ticket.
        patient: {
          id: result.patient.id,
          fullName: maskPatientName(result.patient.fullName),
        },
        doctor: result.doctor,
        cabinet: result.cabinet,
      },
      result.duplicate ? 200 : 201,
    );
  });
}
