/**
 * POST /api/crm/appointments/walkin
 *
 * CRM front-desk equivalent of the public kiosk walk-in: the receptionist
 * issues a live-queue ticket for a patient standing at the desk instead of
 * sending them to the self-service kiosk. Drops the patient straight into the
 * chosen doctor's WAITING queue with an allocated ticket number.
 *
 * Shares the allocation path (`registerWalkin`) with the kiosk so the board,
 * kiosk, and patient ticket never disagree.
 *
 * Body: { doctorId, patientId? , newPatient?: { fullName, phone }, durationMin? }
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { ok, err } from "@/server/http";
import { audit } from "@/lib/audit";
import { registerWalkin } from "@/server/appointments/walkin";

const Body = z
  .object({
    doctorId: z.string().min(1),
    patientId: z.string().min(1).optional(),
    newPatient: z
      .object({
        fullName: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(3).max(20),
      })
      .optional(),
    durationMin: z.number().int().min(5).max(480).optional(),
  })
  .refine((b) => Boolean(b.patientId) || Boolean(b.newPatient), {
    message: "patient_required",
  });

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST"], bodySchema: Body },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const result = await registerWalkin({
      clinicId: ctx.clinicId,
      doctorId: body.doctorId,
      patient: body.patientId
        ? { id: body.patientId }
        : {
            fullName: body.newPatient!.fullName,
            phone: body.newPatient!.phone,
          },
      createdById: ctx.userId,
      durationMin: body.durationMin,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "doctor_not_found":
          return err("doctor_not_found", 404);
        case "patient_not_found":
          return err("patient_not_found", 404);
        case "bad_phone":
          return err("bad_phone", 400);
      }
    }

    await audit(request, {
      action: "appointment.walkin_issued",
      entityType: "Appointment",
      entityId: result.appointmentId,
      meta: {
        doctorId: body.doctorId,
        patientId: result.patient.id,
        queueOrder: result.queueOrder,
      },
    });

    return ok(
      {
        appointmentId: result.appointmentId,
        ticketCode: result.ticketCode,
        ticketNumber: result.ticketNumber,
        queueOrder: result.queueOrder,
        patient: result.patient,
        doctor: result.doctor,
        cabinet: result.cabinet,
      },
      201,
    );
  },
);
