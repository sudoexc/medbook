import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolvePublicClinic } from "@/lib/public-clinic";
import { rateLimit } from "@/lib/rate-limit";
import { realClientIp } from "@/lib/client-ip";
import { sendNewLeadEmail } from "@/lib/email";
import { isValidUzPhone, normalizePhone } from "@/lib/phone";
import { leadDirectionKey } from "@/lib/lead-directions";
import ruMessages from "@/messages/ru.json";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import { z } from "zod";

// An Uzbek number on any operator code, with or without the country code and
// grouped any usual way. The same rule the form checks before sending
// (isValidUzPhone), so the form and the API agree: the old form refused every
// code but 9x while this schema took anything of 9 to 20 characters, and
// «33 412 55 67» sent directly was stored as «+334125567» (audit LD-10). A
// refusal names the `phone` field, which the form shows under that field.
const PhoneInput = z
  .string()
  .max(32)
  .refine(isValidUzPhone, "Invalid phone");

const LeadSchema = z.object({
  name: z.string().min(2).max(100),
  phone: PhoneInput,
  doctorId: z.string().max(50).optional(),
  // A direction key from the form («Направление», lead-directions.ts). An
  // unknown value is dropped rather than refused: the request still lands.
  service: z.string().max(200).optional(),
  date: z.string().max(10).optional(),
  // Drives the notification email language only — NOT persisted on Lead.
  locale: z.enum(["ru", "uz"]).default("ru"),
});

/** Absolute origin for links in emails (env first, request origin fallback). */
function appBaseUrl(request: Request): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ||
    new URL(request.url).origin
  );
}

// No GET here (audit LD-11). The old one checked only for a session, so a
// nurse or a doctor could read every request's name and phone, though the
// role matrix gives them no access to leads. Nothing called it: the CRM
// «Заявки» screen reads /api/crm/online-requests, which keeps the desk,
// call center and admin roles (ONLINE_REQUEST_ROLES).

export async function POST(request: Request) {
  // Rate limit: 10 submissions per minute per IP. The real peer address, not
  // the raw client-written X-Forwarded-For header (audit SEC-03), and its own
  // store so a flood here cannot evict other limiters' counters.
  if (!rateLimit(`lead:${realClientIp(request)}`, 10, 60_000, "leads")) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = LeadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  // Normalize phone at the write boundary so every downstream lookup
  // (receptionist, kiosk check-in, patient upsert) matches.
  const normalizedPhone = normalizePhone(parsed.data.phone);
  if (!normalizedPhone) {
    return Response.json({ error: { phone: ["Invalid phone"] } }, { status: 400 });
  }

  // Public landing form carries no tenant context — resolve the clinic from
  // ?c=/?clinicSlug= (or the default) so the Lead gets its required clinicId.
  const clinic = await resolvePublicClinic(request);
  if (!clinic) {
    return Response.json({ error: "Clinic not found" }, { status: 404 });
  }

  // Only attach a doctor that actually belongs to the resolved clinic — an
  // attacker can't link a lead to another tenant's doctor. `isActive` is a
  // server-side guard, not just a UI filter: a lead pinned to a deactivated
  // doctor sits in a queue nobody processes. The lead itself still lands
  // (doctor becomes null → reception routes it), the request isn't lost.
  // Same for a doctor taken off the site (audit LD-08): a page opened before
  // the switch still offers him, the clinic no longer does.
  let doctor: { nameRu: string; email: string | null } | null = null;
  if (parsed.data.doctorId) {
    const found = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.doctor.findFirst({
        where: {
          id: parsed.data.doctorId,
          clinicId: clinic.id,
          isActive: true,
          listedOnSite: true,
        },
        select: { nameRu: true, user: { select: { email: true } } },
      }),
    );
    if (found) doctor = { nameRu: found.nameRu, email: found.user?.email ?? null };
  }

  // "YYYY-MM-DD" → DateTime. Empty/invalid becomes null (the column is optional).
  const date =
    parsed.data.date && !Number.isNaN(Date.parse(parsed.data.date))
      ? new Date(parsed.data.date)
      : null;

  const doctorId = doctor ? (parsed.data.doctorId ?? null) : null;
  // What the visitor asked for, so a request for an EEG or the pediatric
  // neurologist reaches reception as such instead of riding on whichever
  // doctor the form used to force (audit LD-09). Stored as the stable key;
  // screens translate it.
  const service = leadDirectionKey(parsed.data.service);
  // The row and its `lead.created` event commit together (outbox): a request
  // that reached the table always reaches reception too (audit LD-01). Before
  // this, the only reaction was an SMTP email that silently never went out,
  // and the request sat in a table no screen read.
  const lead = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.$transaction(async (tx) => {
      const row = await tx.lead.create({
        data: {
          clinicId: clinic.id,
          name: parsed.data.name,
          phone: normalizedPhone,
          service,
          date,
          doctorId,
          source: "WEBSITE",
        },
        select: { id: true, name: true, phone: true, service: true },
      });
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: "EXTERNAL",
          userId: null,
          patientId: null,
          onBehalfOfPatientId: null,
          label: "website",
        },
        surface: "WEBSITE",
        tenantScope: {
          clinicId: clinic.id,
          ...(doctorId ? { doctorId } : {}),
        },
        type: "lead.created",
        payload: {
          leadId: row.id,
          status: "NEW",
          source: "WEBSITE",
          name: row.name,
          doctorId,
        },
      });
      return row;
    }),
  );

  // Fire-and-forget heads-up to the chosen doctor (already validated to this
  // clinic). Reception handles the request; the email is informational.
  if (doctor?.email) {
    sendNewLeadEmail({
      doctorEmail: doctor.email,
      doctorName: doctor.nameRu,
      patientName: lead.name,
      patientPhone: lead.phone,
      // The email is Russian-only; name the direction, not its key.
      service: service ? ruMessages.leadForm.directions[service] : undefined,
      date: parsed.data.date || undefined,
      cabinetUrl: `${appBaseUrl(request)}/doctor`,
    }).catch((err) => console.error("[email]", err));
  }

  return Response.json({ success: true, id: lead.id }, { status: 201 });
}
