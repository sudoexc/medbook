/**
 * Radix Select reserves the empty string: a `<SelectItem value="">` throws
 * («A <Select.Item /> must have a value prop that is not an empty string»)
 * as soon as the content mounts, closed or not. /admin/users and
 * /admin/audit had «Все роли» / «Все клиники» / «без клиники» as `value=""`
 * and fell into the error boundary on every load (audit G5-04).
 *
 * The items carry these sentinels instead; state keeps "" for «no filter»
 * and converts at the Select's edge.
 */
export const SELECT_ALL = "__all__";
export const SELECT_NONE = "__none__";

/** State → Select value: an empty filter shows the sentinel item. */
export function toSelectValue(value: string, sentinel: string = SELECT_ALL): string {
  return value === "" ? sentinel : value;
}

/** Select value → state: a sentinel means no value. */
export function fromSelectValue(value: string): string {
  return value === SELECT_ALL || value === SELECT_NONE ? "" : value;
}
