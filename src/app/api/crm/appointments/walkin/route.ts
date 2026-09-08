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
import { prisma } from "@/lib/prisma";
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
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"], bodySchema: Body },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    // A doctor may queue walk-ins, but only into their OWN queue: returning
    // patients who walk straight past the front desk are the whole point, and
    // letting one doctor fill a colleague's queue is not. Resolved per request
    // rather than trusted from the body — the same reason /doctors/me does it.
    let doctorId = body.doctorId;
    if (ctx.role === "DOCTOR") {
      const self = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true, isActive: true },
      });
      if (!self) return err("doctor_not_found", 404);
      if (!self.isActive) return err("Forbidden", 403);
      if (doctorId !== self.id) return err("Forbidden", 403);
      doctorId = self.id;
    }

    const result = await registerWalkin({
      clinicId: ctx.clinicId,
      doctorId,
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
        doctorId,
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
