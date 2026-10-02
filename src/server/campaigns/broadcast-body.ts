/**
 * The text a broadcast patient receives (audit G6-21).
 *
 * One place builds the placeholder values and renders them, for both the
 * launcher (`launch.ts`, stored per recipient and sent through the clinic
 * adapter's HTML pass) and the composer's preview. The preview used to fill
 * five tokens by hand with i18n stand-ins («ул. Примерная, 1») and draw the
 * text as chat markdown, so «**Акция**» looked bold there and reached the
 * patients with its asterisks, and a token the launcher does not know showed
 * in the preview while the patients got an empty gap.
 *
 * Client-safe: no server imports.
 */
import { givenNameOf } from "@/lib/patients/given-name";
import {
  render,
  validate,
  type TemplateContext,
} from "@/server/notifications/template";

/** Every `{{…}}` a broadcast can carry: what `broadcastContext` fills. */
export const BROADCAST_PLACEHOLDERS = [
  "patient.firstName",
  "patient.name",
  "clinic.name",
  "clinic.phone",
  "clinic.address",
] as const;

export type BroadcastClinic = {
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
};

export function broadcastContext(
  patient: { fullName: string },
  clinic: BroadcastClinic,
  lang: "RU" | "UZ",
): TemplateContext {
  return {
    patient: {
      name: patient.fullName,
      firstName: givenNameOf(patient.fullName),
    },
    clinic: {
      name: lang === "UZ" ? clinic.nameUz : clinic.nameRu,
      phone: clinic.phone ?? "",
      address: (lang === "UZ" ? clinic.addressUz : clinic.addressRu) ?? "",
    },
  };
}

/** The stored body for one recipient (`NotificationSend.body`). */
export function renderBroadcastBody(
  body: string,
  patient: { fullName: string },
  clinic: BroadcastClinic,
  lang: "RU" | "UZ",
): string {
  return render(body, broadcastContext(patient, clinic, lang));
}

/**
 * Tokens nothing fills: `render()` would send each as an empty gap, so the
 * composer warns and the broadcast endpoint refuses the text.
 */
export function unknownBroadcastPlaceholders(body: string): string[] {
  return validate(body, [...BROADCAST_PLACEHOLDERS]).unknown;
}
