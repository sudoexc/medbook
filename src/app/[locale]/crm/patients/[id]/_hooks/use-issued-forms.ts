"use client";

/**
 * Register of the e-prescriptions and sick-leave certificates issued to a
 * patient (audit CD-07). Issuing new ones is switched off
 * (`@/lib/clinical-forms-issuing`), but a form already handed out must stay
 * findable, reprintable and cancellable: a sick leave with wrong dates kept
 * showing «ДЕЙСТВУЕТ» on its public QR check with nothing to cancel it from.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type IssuedFormKind = "rx" | "sl";

export type IssuedForm = {
  kind: IssuedFormKind;
  id: string;
  number: string;
  issuedAt: string;
  /** Rx: valid until; SL: the certificate period. */
  validUntilAt: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: "ISSUED" | "CANCELLED";
  /** An issued Rx past its validity, as of when the list was fetched. */
  expired: boolean;
  cancelReason: string | null;
  doctorName: string | null;
};

type RxRow = {
  id: string;
  rxNumber: string;
  issuedAt: string;
  validUntilAt: string;
  status: "ISSUED" | "CANCELLED";
  cancelReason: string | null;
  doctorName?: string | null;
};

type SlRow = {
  id: string;
  certNumber: string;
  issuedAt: string;
  periodFrom: string;
  periodTo: string;
  status: "ISSUED" | "CANCELLED";
  cancelReason: string | null;
  doctorName?: string | null;
};

const BASE: Record<IssuedFormKind, string> = {
  rx: "/api/crm/e-prescriptions",
  sl: "/api/crm/sick-leaves",
};

export function issuedFormPrintHref(form: Pick<IssuedForm, "kind" | "id">): string {
  return `${BASE[form.kind]}/${encodeURIComponent(form.id)}/print`;
}

/** Newest first across both kinds. Pure, for the unit test. */
export function mergeIssuedForms(
  rx: RxRow[],
  sl: SlRow[],
  now: Date = new Date(),
): IssuedForm[] {
  const rows: IssuedForm[] = [
    ...rx.map<IssuedForm>((r) => ({
      kind: "rx",
      id: r.id,
      number: r.rxNumber,
      issuedAt: r.issuedAt,
      validUntilAt: r.validUntilAt,
      periodFrom: null,
      periodTo: null,
      status: r.status,
      expired:
        r.status === "ISSUED" &&
        new Date(r.validUntilAt).getTime() < now.getTime(),
      cancelReason: r.cancelReason,
      doctorName: r.doctorName ?? null,
    })),
    ...sl.map<IssuedForm>((r) => ({
      kind: "sl",
      id: r.id,
      number: r.certNumber,
      issuedAt: r.issuedAt,
      validUntilAt: null,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      status: r.status,
      // A sick leave is a record of the period, it does not expire.
      expired: false,
      cancelReason: r.cancelReason,
      doctorName: r.doctorName ?? null,
    })),
  ];
  return rows.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
}

async function fetchRows<T>(url: string, signal: AbortSignal): Promise<T[]> {
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { rows: T[] }).rows;
}

export function issuedFormsKey(patientId: string) {
  return ["patient", patientId, "issued-forms"] as const;
}

export function useIssuedForms(patientId: string, enabled: boolean) {
  return useQuery<IssuedForm[], Error>({
    queryKey: issuedFormsKey(patientId),
    enabled,
    queryFn: async ({ signal }) => {
      const qs = `?patientId=${encodeURIComponent(patientId)}&limit=100`;
      const [rx, sl] = await Promise.all([
        fetchRows<RxRow>(`${BASE.rx}${qs}`, signal),
        fetchRows<SlRow>(`${BASE.sl}${qs}`, signal),
      ]);
      return mergeIssuedForms(rx, sl);
    },
    staleTime: 30_000,
  });
}

export function useCancelIssuedForm(patientId: string) {
  const qc = useQueryClient();
  return useMutation<
    unknown,
    Error,
    { form: Pick<IssuedForm, "kind" | "id">; reason: string }
  >({
    mutationFn: async ({ form, reason }) => {
      const res = await fetch(`${BASE[form.kind]}/${encodeURIComponent(form.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancelReason: reason }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: issuedFormsKey(patientId) });
    },
  });
}
