import { z } from "zod";

export const CurrencyEnum = z.enum(["UZS", "USD"]);
export const PaymentMethodEnum = z.enum([
  "CASH",
  "CARD",
  "TRANSFER",
  "PAYME",
  "CLICK",
  "UZUM",
  "OTHER",
]);
export const PaymentStatusEnum = z.enum([
  "UNPAID",
  "PARTIAL",
  "PAID",
  "REFUNDED",
]);

export const CreatePaymentSchema = z.object({
  appointmentId: z.string().optional().nullable(),
  patientId: z.string().optional().nullable(),
  currency: CurrencyEnum.default("UZS"),
  amount: z.number().int().min(0),
  method: PaymentMethodEnum,
  status: PaymentStatusEnum.default("UNPAID"),
  receiptNumber: z.string().max(100).optional().nullable(),
  receiptUrl: z.string().url().optional().nullable(),
  paidAt: z.coerce.date().optional().nullable(),
  externalRef: z.string().max(200).optional().nullable(),
  /**
   * Optional client-supplied idempotency key. When the same key is replayed
   * (e.g., after a network retry), the route returns the original payment
   * rather than creating a duplicate. Falls back to the `Idempotency-Key`
   * HTTP header if absent from the body.
   */
  idempotencyKey: z.string().min(1).max(200).optional().nullable(),
});

export const UpdatePaymentSchema = z.object({
  amount: z.number().int().min(0).optional(),
  method: PaymentMethodEnum.optional(),
  status: PaymentStatusEnum.optional(),
  refundedAmount: z.number().int().min(0).optional(),
  receiptNumber: z.string().max(100).nullable().optional(),
  receiptUrl: z.string().url().nullable().optional(),
  paidAt: z.coerce.date().nullable().optional(),
  externalRef: z.string().max(200).nullable().optional(),
});

export const QueryPaymentSchema = z.object({
  status: PaymentStatusEnum.optional(),
  method: PaymentMethodEnum.optional(),
  patientId: z.string().optional(),
  appointmentId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreatePayment = z.infer<typeof CreatePaymentSchema>;
export type UpdatePayment = z.infer<typeof UpdatePaymentSchema>;
