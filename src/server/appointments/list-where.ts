/**
 * The search box of «Записи»: patient name or phone, doctor name. Shared by
 * GET /api/crm/appointments and the appointments CSV export, so the file
 * holds the rows the list shows (audit INF-02).
 */
import { normalizePhone } from "@/lib/phone";

type Where = Record<string, unknown>;

/** The `OR` for a search term, or null for an empty one. */
export function appointmentSearchOr(raw: string | null | undefined): Where[] | null {
  const term = (raw ?? "").trim();
  if (term.length === 0) return null;
  const phoneDigits = term.replace(/\D/g, "");
  const phoneNorm = normalizePhone(term);
  const or: Where[] = [
    { patient: { fullName: { contains: term, mode: "insensitive" } } },
    { patient: { phone: { contains: term } } },
    { doctor: { nameRu: { contains: term, mode: "insensitive" } } },
    { doctor: { nameUz: { contains: term, mode: "insensitive" } } },
  ];
  if (phoneDigits.length >= 3) {
    or.push({ patient: { phoneNormalized: { contains: phoneDigits } } });
    if (phoneNorm) {
      or.push({ patient: { phoneNormalized: { contains: phoneNorm } } });
    }
  }
  return or;
}
