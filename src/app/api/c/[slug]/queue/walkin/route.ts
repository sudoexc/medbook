/**
 * POST /api/c/[slug]/queue/walkin
 *
 * Public kiosk endpoint: register a walk-in patient (no prior appointment),
 * place them at the back of the chosen doctor's live queue, and return the
 * ticket payload for printing.
 *
 * Body: { fullName, phone, doctorId, lang? }
 *
 * The queue insertion itself lives in `registerWalkin` (shared with the CRM
 * front-desk endpoint) so both surfaces allocate the slot identically.
 */
import { z } from "zod";

import { ok, err } from "@/server/http";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { runWithTenant } from "@/lib/tenant-context";
import { registerWalkin } from "@/server/appointments/walkin";

const Body = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(3).max(20),
  doctorId: z.string().min(1),
  lang: z.enum(["RU", "UZ"]).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch {
    return err("bad_body", 400);
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const result = await registerWalkin({
      clinicId: ctx.clinicId,
      doctorId: parsed.doctorId,
      patient: {
        fullName: parsed.fullName,
        phone: parsed.phone,
        lang: parsed.lang,
      },
    });

    if (!result.ok) {
      if (result.reason === "doctor_not_found") return err("doctor_not_found", 404);
      return err(result.reason, 400);
    }

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
  });
}
