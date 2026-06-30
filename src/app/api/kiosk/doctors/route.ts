import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolvePublicClinic } from "@/lib/public-clinic";

// GET /api/kiosk/doctors — public, returns active doctors with their active
// services for the kiosk service picker. Tenant-scoped to the resolved public
// clinic (?c=<slug> | ?clinicSlug=<slug> | DEFAULT_CLINIC_SLUG). Runs in a
// SYSTEM context with an explicit clinicId so the anonymous request never sees
// another tenant's roster. The kiosk reads only `services` here (it takes the
// cabinet from the schedule board); prices are returned in whole soms because
// the kiosk multiplies back by 100 before `formatMoney`.
export async function GET(request: Request) {
  const clinic = await resolvePublicClinic(request);
  if (!clinic) return Response.json([]);

  const doctors = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.doctor.findMany({
      where: { clinicId: clinic.id, isActive: true },
      orderBy: { cabinet: { number: "asc" } },
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        cabinet: { select: { number: true } },
        services: {
          select: {
            priceOverride: true,
            service: {
              select: {
                nameRu: true,
                nameUz: true,
                priceBase: true,
                isActive: true,
              },
            },
          },
        },
      },
    }),
  );

  return Response.json(
    doctors.map((d) => ({
      id: d.id,
      nameRu: d.nameRu,
      nameUz: d.nameUz,
      cabinet: d.cabinet?.number ?? null,
      services: d.services
        .filter((s) => s.service.isActive)
        .map((s) => ({
          nameRu: s.service.nameRu,
          nameUz: s.service.nameUz,
          // DB stores tiins; kiosk expects whole soms and re-applies *100.
          price: Math.round((s.priceOverride ?? s.service.priceBase) / 100),
        })),
    })),
  );
}
