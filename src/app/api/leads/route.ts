import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { resolvePublicClinic } from "@/lib/public-clinic";
import { rateLimit } from "@/lib/rate-limit";
import { sendNewLeadEmail } from "@/lib/email";
import { normalizePhone } from "@/lib/phone";
import { z } from "zod";

// Phone accepts Uzbek numbers, with or without leading "+" and typical grouping
// characters. normalizePhone() downstream enforces the canonical form.
const PhoneInput = z
  .string()
  .min(9)
  .max(20)
  .regex(/^[+\d\s()-]+$/, "Invalid phone");

const LeadSchema = z.object({
  name: z.string().min(2).max(100),
  phone: PhoneInput,
  doctorId: z.string().max(50).optional(),
  service: z.string().max(200).optional(),
  date: z.string().max(10).optional(),
  // Drives the notification email language only — NOT persisted on Lead.
  locale: z.enum(["ru", "uz"]).default("ru"),
});

const VALID_STATUSES = ["NEW", "CONTACTED", "CONVERTED", "CANCELLED"] as const;
type LeadStatus = (typeof VALID_STATUSES)[number];

export async function GET(request: Request) {
  // Staff-only and tenant-scoped. The previous version authorised via
  // isAuthorizedOrPin (no clinic context) and queried Lead unscoped, leaking
  // every tenant's lead volume/list to any authenticated caller. We now scope
  // to the caller's clinic through a TENANT context.
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clinicId = session.user.clinicId;
  if (!clinicId) {
    // SUPER_ADMIN without an active impersonation has no home clinic.
    return Response.json({ error: "No clinic context" }, { status: 403 });
  }

  const url = new URL(request.url);
  return runWithTenant(
    {
      kind: "TENANT",
      clinicId,
      userId: session.user.id,
      role: session.user.role,
    },
    async () => {
      if (url.searchParams.get("countNew") === "true") {
        const count = await prisma.lead.count({ where: { status: "NEW" } });
        return Response.json({ count });
      }

      const status = url.searchParams.get("status");
      const limitRaw = Number(url.searchParams.get("limit"));
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), 200)
          : 50;
      const statusFilter = VALID_STATUSES.includes(status as LeadStatus)
        ? { status: status as LeadStatus }
        : {};

      const leads = await prisma.lead.findMany({
        where: statusFilter,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: limit,
      });
      return Response.json(leads);
    },
  );
}

export async function POST(request: Request) {
  // Rate limit: 10 submissions per minute per IP
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimit(ip)) {
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
  // attacker can't link a lead to another tenant's doctor. Pull the email here
  // so the notification path doesn't re-query.
  let doctor: { nameRu: string; email: string | null } | null = null;
  if (parsed.data.doctorId) {
    const found = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.doctor.findFirst({
        where: { id: parsed.data.doctorId, clinicId: clinic.id },
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

  const lead = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.lead.create({
      data: {
        clinicId: clinic.id,
        name: parsed.data.name,
        phone: normalizedPhone,
        service: parsed.data.service ?? null,
        date,
        doctorId: doctor ? parsed.data.doctorId : null,
        source: "WEBSITE",
      },
      select: { id: true, name: true, phone: true, service: true },
    }),
  );

  // Fire-and-forget doctor notification (already validated to this clinic).
  if (doctor?.email) {
    sendNewLeadEmail({
      doctorEmail: doctor.email,
      doctorName: doctor.nameRu,
      patientName: lead.name,
      patientPhone: lead.phone,
      service: lead.service || undefined,
      date: parsed.data.date || undefined,
    }).catch((err) => console.error("[email]", err));
  }

  return Response.json({ success: true, id: lead.id }, { status: 201 });
}
