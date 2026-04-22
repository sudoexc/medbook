# Payments API

Base path: `/api/crm/payments`

## Endpoints

### `GET /api/crm/payments`
- **Roles:** ADMIN, RECEPTIONIST, DOCTOR, CALL_OPERATOR.
- Filters: `status`, `method`, `patientId`, `appointmentId`, `from`, `to`. Cursor pagination.

### `POST /api/crm/payments`
- **Roles:** ADMIN, RECEPTIONIST. Body: `CreatePaymentSchema`.
- On create with `status: PAID`, recomputes patient LTV synchronously via `recalcLtv()`. Populates `fxRate` / `amountUsdSnap` from latest ExchangeRate.
- **201:** Payment row.

### `PATCH /api/crm/payments/[id]`
- **Roles:** ADMIN, RECEPTIONIST. Body: `UpdatePaymentSchema`.
- Transition to/from PAID triggers LTV recalc.
