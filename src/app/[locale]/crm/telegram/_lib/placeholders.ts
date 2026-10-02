/**
 * Client-side placeholder fill for chat snippets and broadcast previews.
 *
 * The real substitution for broadcasts happens server-side in
 * `campaigns/launch.ts`; direct chat sends carry no rendering step, so when an
 * operator inserts a canned response we fill the tokens here so the text the
 * patient receives is already resolved.
 */

import { threadProfileName } from "@/lib/patients/telegram-card";

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

/**
 * A token with no value stays in the text (audit G6-15): the operator sees
 * «{{clinic.phone}}» in the composer and fixes it, where an empty value
 * sent the patient «, здравствуйте! Клиника , телефон ».
 */
export function fillPlaceholders(body: string, vals: PlaceholderValues): string {
  const put = (value: string) => (token: string) => value || token;
  return body
    .replace(/\{\{\s*patient\.firstName\s*\}\}/g, put(vals.firstName))
    .replace(/\{\{\s*patient\.name\s*\}\}/g, put(vals.name))
    .replace(/\{\{\s*clinic\.name\s*\}\}/g, put(vals.clinic))
    .replace(/\{\{\s*clinic\.phone\s*\}\}/g, put(vals.phone))
    .replace(/\{\{\s*clinic\.address\s*\}\}/g, put(vals.address));
}

/** Does the text still hold a `{{…}}` token nobody filled? */
export function hasUnfilledPlaceholders(text: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(text);
}

/**
 * Who a quick reply greets (audit G6-15). A linked chat greets the card's
 * given name. Most bot chats are not linked to a card, and they greet the
 * Telegram profile's first name rather than nobody.
 */
export function replyRecipient(conv: {
  patient: { fullName: string } | null;
  contactFirstName: string | null;
  contactLastName: string | null;
}): { firstName: string; name: string } {
  const fullName = conv.patient?.fullName.trim() ?? "";
  if (fullName) return { firstName: firstNameOf(fullName), name: fullName };
  return {
    firstName: conv.contactFirstName?.trim() ?? "",
    name: threadProfileName(conv) ?? "",
  };
}
