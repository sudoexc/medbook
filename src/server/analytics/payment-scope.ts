/**
 * Which payments a revenue figure covers (audit AN-20).
 *
 * `Payment` is clinic-scoped, not branch-scoped (tenant-allowlist.ts), so
 * with a branch selected every appointment count narrowed to the branch
 * while the revenue next to it stayed the whole network's. A payment
 * belongs to a branch through the visit it is filed under; one with no
 * visit has no branch and only counts clinic-wide. The same relation
 * narrows to one doctor for the doctor's own analytics.
 */
export function paymentScopeWhere(scope: {
  branchId?: string | null;
  doctorId?: string | null;
}): { appointment?: { branchId?: string; doctorId?: string } } {
  const appointment: { branchId?: string; doctorId?: string } = {};
  if (scope.branchId) appointment.branchId = scope.branchId;
  if (scope.doctorId) appointment.doctorId = scope.doctorId;
  return Object.keys(appointment).length > 0 ? { appointment } : {};
}
