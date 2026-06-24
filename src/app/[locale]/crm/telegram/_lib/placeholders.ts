/**
 * Client-side placeholder fill for chat snippets and broadcast previews.
 *
 * The real substitution for broadcasts happens server-side in
 * `campaigns/launch.ts`; direct chat sends carry no rendering step, so when an
 * operator inserts a canned response we fill the tokens here so the text the
 * patient receives is already resolved.
 */

export type PlaceholderValues = {
  firstName: string;
  name: string;
  clinic: string;
  phone: string;
  address: string;
};

/** Russian-style "Фамилия Имя Отчество" — first name is the second token. */
export function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[1] ?? parts[0] ?? "";
}

export function fillPlaceholders(body: string, vals: PlaceholderValues): string {
  return body
    .replace(/\{\{\s*patient\.firstName\s*\}\}/g, vals.firstName)
    .replace(/\{\{\s*patient\.name\s*\}\}/g, vals.name)
    .replace(/\{\{\s*clinic\.name\s*\}\}/g, vals.clinic)
    .replace(/\{\{\s*clinic\.phone\s*\}\}/g, vals.phone)
    .replace(/\{\{\s*clinic\.address\s*\}\}/g, vals.address);
}
