import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { z } from "zod";

const CreateSchema = z.object({
  appointmentId: z.string(),
  amount: z.number().int().min(0),
  method: z.enum(["CASH", "CARD", "TRANSFER"]).optional(),
  status: z.enum(["UNPAID", "PAID"]).optional(),
});

const UpdateSchema = z.object({
  id: z.string(),
  status: z.enum(["UNPAID", "PAID"]).optional(),
  method: z.enum(["CASH", "CARD", "TRANSFER"]).optional(),
  amount: z.number().int().min(0).optional(),
});

// GET /api/payments?from=&to=&doctorId=&status=&patientId=
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const doctorId = url.searchParams.get("doctorId");
  const status = url.searchParams.get("status");
  const patientId = url.searchParams.get("patientId");

  const isAdmin = session.user.role === "ADMIN";

  const where: Record<string, unknown> = {};

  // Date filter
  if (from || to) {
    where.appointment = {
      date: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to + "T23:59:59") } : {}),
      },
    };
  }

  // Doctor filter: non-admins locked to their own doctorId regardless of query
  const effectiveDoctorId = isAdmin ? doctorId : session.user.doctorId;
  if (effectiveDoctorId) {
    where.appointment = { ...((where.appointment as object) || {}), doctorId: effectiveDoctorId };
  }

  // Status filter
  if (status === "PAID" || status === "UNPAID") {
    where.status = status;
  }

  // Patient filter
  if (patientId) {
    where.appointment = { ...((where.appointment as object) || {}), patientId };
  }

  const payments = await prisma.payment.findMany({
    where,
    include: {
      appointment: {
        include: { patient: true, doctor: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // Summary
  const totalAmount = payments.reduce((s, p) => s + p.amount, 0);
  const paidAmount = payments.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0);
  const unpaidAmount = payments.filter((p) => p.status === "UNPAID").reduce((s, p) => s + p.amount, 0);

  return Response.json({ payments, summary: { totalAmount, paidAmount, unpaidAmount } });
}

// POST /api/payments — create payment
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { appointmentId, amount, method, status } = parsed.data;

  const payment = await prisma.payment.upsert({
    where: { appointmentId },
    create: {
      appointmentId,
      amount,
      method: method || "CASH",
      status: status || "UNPAID",
      paidAt: status === "PAID" ? new Date() : null,
    },
    update: {
      amount,
      ...(method ? { method } : {}),
      ...(status ? { status, paidAt: status === "PAID" ? new Date() : null } : {}),
    },
  });
  await audit(request, {
    action: "payment.upsert",
    entityType: "Payment",
    entityId: payment.id,
    meta: { appointmentId, amount, method, status },
  });

  return Response.json(payment);
}

// PATCH /api/payments — update payment status
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { id, status, method, amount } = parsed.data;

  const before = await prisma.payment.findUnique({
    where: { id },
    select: { status: true, method: true, amount: true },
  });
  const payment = await prisma.payment.update({
    where: { id },
    data: {
      ...(status ? { status, paidAt: status === "PAID" ? new Date() : null } : {}),
      ...(method ? { method } : {}),
      ...(amount !== undefined ? { amount } : {}),
    },
  });
  await audit(request, {
    action: "payment.update",
    entityType: "Payment",
    entityId: id,
    meta: { before, after: { status, method, amount } },
  });

  return Response.json(payment);
}
