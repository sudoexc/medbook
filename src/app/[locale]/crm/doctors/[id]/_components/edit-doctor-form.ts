/**
 * Form model of «Редактировать врача» (audit DR-04), pure so it is tested.
 *
 * The CRM could create a doctor but never edit one: a typo in the surname, a
 * visit price typed in the wrong units or a new salary agreement stayed
 * forever (or meant deactivating the doctor and losing his history). The
 * dialog edits the profile columns; the cabinet, services, ticket letter and
 * login keep their own dedicated editors.
 *
 * Only changed fields are sent: a legacy value the stricter write schema
 * would now refuse (an old photo path, a name typed years ago) must not
 * block saving an unrelated field.
 */
import { sumToTiyin, tiyinToSum } from "@/lib/money-input";

import type { DoctorDetail, DoctorUpdateInput } from "../_hooks/use-doctor";

export type EditDoctorForm = {
  nameRu: string;
  nameUz: string;
  specRu: string;
  specUz: string;
  slug: string;
  color: string;
  /** Visit price in сумы, digits only; empty means «not set». */
  pricePerVisit: string;
  salaryPercent: string;
  photoUrl: string;
  bioRu: string;
  bioUz: string;
  /** «Показывать на сайте» (audit LD-08). */
  listedOnSite: boolean;
};

export type EditDoctorField = keyof EditDoctorForm;

type EditDoctorTextField = Exclude<EditDoctorField, "listedOnSite">;

export type EditDoctorPatch = DoctorUpdateInput;

export function formFromDoctor(d: DoctorDetail): EditDoctorForm {
  return {
    nameRu: d.nameRu ?? "",
    nameUz: d.nameUz ?? "",
    specRu: d.specializationRu ?? "",
    specUz: d.specializationUz ?? "",
    slug: d.slug ?? "",
    color: d.color ?? "#3DD5C0",
    pricePerVisit:
      d.pricePerVisit != null ? String(tiyinToSum(d.pricePerVisit)) : "",
    salaryPercent: d.salaryPercent != null ? String(d.salaryPercent) : "",
    photoUrl: d.photoUrl ?? "",
    bioRu: d.bioRu ?? "",
    bioUz: d.bioUz ?? "",
    // A row read before the column existed counts as shown, like the default.
    listedOnSite: d.listedOnSite !== false,
  };
}

const SLUG_RE = /^[a-z0-9-]{2,100}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The PATCH body for what changed, or the first field that cannot be saved.
 * An empty patch means nothing changed.
 */
export function buildDoctorPatch(
  d: DoctorDetail,
  form: EditDoctorForm,
): { ok: true; patch: EditDoctorPatch } | { ok: false; field: EditDoctorField } {
  const initial = formFromDoctor(d);
  const patch: EditDoctorPatch = {};
  const changed = (k: EditDoctorTextField) => form[k].trim() !== initial[k].trim();

  const required: Array<[EditDoctorTextField, keyof EditDoctorPatch]> = [
    ["nameRu", "nameRu"],
    ["nameUz", "nameUz"],
    ["specRu", "specializationRu"],
    ["specUz", "specializationUz"],
  ];
  for (const [field, key] of required) {
    const v = form[field].trim();
    if (!v) return { ok: false, field };
    if (changed(field)) (patch as Record<string, unknown>)[key] = v;
  }

  if (changed("slug")) {
    const slug = form.slug.trim();
    if (!SLUG_RE.test(slug)) return { ok: false, field: "slug" };
    patch.slug = slug;
  }

  if (form.color !== initial.color) {
    if (!COLOR_RE.test(form.color)) return { ok: false, field: "color" };
    patch.color = form.color;
  }

  if (changed("pricePerVisit")) {
    const raw = form.pricePerVisit.trim();
    if (raw === "") patch.pricePerVisit = null;
    else if (!/^\d+$/.test(raw)) return { ok: false, field: "pricePerVisit" };
    else patch.pricePerVisit = sumToTiyin(Number(raw));
  }

  if (changed("salaryPercent")) {
    const raw = form.salaryPercent.trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || n > 100) {
      return { ok: false, field: "salaryPercent" };
    }
    patch.salaryPercent = n;
  }

  if (changed("photoUrl")) {
    const raw = form.photoUrl.trim();
    if (raw === "") patch.photoUrl = null;
    else if (!isHttpUrl(raw)) return { ok: false, field: "photoUrl" };
    else patch.photoUrl = raw;
  }

  for (const [field, key] of [
    ["bioRu", "bioRu"],
    ["bioUz", "bioUz"],
  ] as const) {
    if (changed(field)) {
      const v = form[field].trim();
      patch[key] = v === "" ? null : v;
    }
  }

  if (form.listedOnSite !== initial.listedOnSite) {
    patch.listedOnSite = form.listedOnSite;
  }

  return { ok: true, patch };
}
