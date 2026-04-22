// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { prisma } from "./prisma";
import type { Locale } from "@/types";

export interface DoctorView {
  id: string;
  name: Record<Locale, string>;
  specialty: Record<Locale, string>;
  cabinet: number;
  schedule: Record<Locale, string>;
  hours: string;
  photo: string | null;
  services: { name: Record<Locale, string>; price: number }[];
}

function toView(doc: {
  id: string;
  nameRu: string;
  nameUz: string;
  specialtyRu: string;
  specialtyUz: string;
  cabinet: number;
  scheduleRu: string;
  scheduleUz: string;
  hours: string;
  photo: string | null;
  services: unknown;
}): DoctorView {
  const services = (doc.services as { nameRu: string; nameUz: string; price: number }[]).map(
    (s) => ({
      name: { ru: s.nameRu, uz: s.nameUz },
      price: s.price,
    })
  );

  return {
    id: doc.id,
    name: { ru: doc.nameRu, uz: doc.nameUz },
    specialty: { ru: doc.specialtyRu, uz: doc.specialtyUz },
    cabinet: doc.cabinet,
    schedule: { ru: doc.scheduleRu, uz: doc.scheduleUz },
    hours: doc.hours,
    photo: doc.photo,
    services,
  };
}

export async function getDoctors(): Promise<DoctorView[]> {
  // TODO(phase-1): legacy schema mismatch — swallow to keep prod build working
  // until api-builder rewrites this against the Phase 1 schema.
  try {
    const docs = await prisma.doctor.findMany({
      where: { active: true },
      orderBy: { cabinet: "asc" },
    });
    return docs.map(toView);
  } catch {
    return [];
  }
}

export async function getDoctorById(id: string): Promise<DoctorView | null> {
  try {
    const doc = await prisma.doctor.findUnique({ where: { id } });
    if (!doc || !doc.active) return null;
    return toView(doc);
  } catch {
    return null;
  }
}
