/**
 * /api/crm/patients/stats — lightweight aggregations for the patients
 * list right-rail widgets (Phase 2a).
 *
 * Returns:
 *   - `gender`:    [{ gender: 'MALE'|'FEMALE'|null, count }]
 *   - `ageGroups`: [{ group: '0-18'|'19-35'|'36-55'|'56+', count }]
 *   - `sources`:   [{ source: LeadSource|null, count }]
 *   - `birthdays`: [{ id, fullName, phone, photoUrl, birthDate, daysUntil }]
 *   - `topTags`:   [{ tag, count }] — top 5 tags across all patients
 *
 * Scoped by clinic via the Prisma tenant extension. Phase 4 analytics will
 * replace this with a dedicated dashboard endpoint; this is intentionally
 * minimal (single clinic, top-N) for the Phase 2a widgets.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { tashkentComponents } from "@/lib/booking-validation";
import { ok } from "@/server/http";

/**
 * Days from "today" (Tashkent civil date — clinic time, not server-local)
 * until the patient's next birthday. All arithmetic is done in Date.UTC
 * civil space so the server timezone never leaks in.
 */
function daysUntilBirthday(birthDate: Date, ref: Date): number {
  const [ty, tm, td] = tashkentComponents(ref).date.split("-").map(Number);
  const [, bm, bd] = tashkentComponents(birthDate).date.split("-").map(Number);
  const todayUtc = Date.UTC(ty, tm - 1, td);
  let candidate = Date.UTC(ty, bm - 1, bd);
  if (candidate < todayUtc) {
    // birthday already passed this year — roll over to next year
    candidate = Date.UTC(ty + 1, bm - 1, bd);
  }
  return Math.round((candidate - todayUtc) / (1000 * 60 * 60 * 24));
}

function ageFromBirthDate(birthDate: Date, ref: Date): number {
  let age = ref.getFullYear() - birthDate.getFullYear();
  const m = ref.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birthDate.getDate())) age--;
  return age;
}

function ageGroup(age: number): "0-18" | "19-35" | "36-55" | "56+" {
  if (age <= 18) return "0-18";
  if (age <= 35) return "19-35";
  if (age <= 55) return "36-55";
  return "56+";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR"] },
  async () => {
    const now = new Date();

    const [byGender, bySource, birthdayCandidates, taggedSample] =
      await Promise.all([
        prisma.patient.groupBy({
          by: ["gender"],
          _count: { _all: true },
        }),
        prisma.patient.groupBy({
          by: ["source"],
          _count: { _all: true },
        }),
        // Pull patients with a birthDate, compute daysUntil in JS.
        // Prisma doesn't let us filter on (month, day) portably; we cap at 5k
        // to keep this cheap — Phase 4 will move this to a materialized view.
        prisma.patient.findMany({
          where: { birthDate: { not: null } },
          select: {
            id: true,
            fullName: true,
            phone: true,
            photoUrl: true,
            birthDate: true,
          },
          take: 5000,
        }),
        prisma.patient.findMany({
          where: { tags: { isEmpty: false } },
          select: { tags: true },
          take: 2000,
        }),
      ]);

    // Age groups from the same birthday set (covers everyone with DOB).
    const ageGroupsMap = new Map<string, number>([
      ["0-18", 0],
      ["19-35", 0],
      ["36-55", 0],
      ["56+", 0],
    ]);
    const birthdays: Array<{
      id: string;
      fullName: string;
      phone: string;
      photoUrl: string | null;
      birthDate: string;
      daysUntil: number;
    }> = [];
    for (const p of birthdayCandidates) {
      if (!p.birthDate) continue;
      const age = ageFromBirthDate(p.birthDate, now);
      const g = ageGroup(age);
      ageGroupsMap.set(g, (ageGroupsMap.get(g) ?? 0) + 1);

      const d = daysUntilBirthday(p.birthDate, now);
      if (d <= 7) {
        birthdays.push({
          id: p.id,
          fullName: p.fullName,
          phone: p.phone,
          photoUrl: p.photoUrl,
          birthDate: p.birthDate.toISOString(),
          daysUntil: d,
        });
      }
    }
    birthdays.sort((a, b) => a.daysUntil - b.daysUntil);

    const tagCounts = new Map<string, number>();
    for (const row of taggedSample) {
      for (const t of row.tags) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    return ok({
      gender: byGender.map((r) => ({
        gender: r.gender,
        count: r._count._all,
      })),
      ageGroups: Array.from(ageGroupsMap.entries()).map(([group, count]) => ({
        group,
        count,
      })),
      sources: bySource.map((r) => ({
        source: r.source,
        count: r._count._all,
      })),
      birthdays: birthdays.slice(0, 10),
      topTags,
    });
  },
);
