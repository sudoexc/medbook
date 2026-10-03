/**
 * GET /api/crm/doctors/me/drug-shortlist — what opens when the doctor taps
 * the drug field with nothing typed yet.
 *
 *   - `mine`   — his starred drugs, then what he actually prescribes most
 *                (structured rows and free-text lines, drafts included);
 *   - `clinic` — the clinic's core list («основные препараты»), minus what
 *                is already in `mine`. It carries a doctor with no history
 *                yet, and it is the same for every doctor of the clinic.
 *
 * The visit screen's picker (clinic request 03.10.2026: prescribing with
 * the mouse only) reads four more lists from the same history:
 *
 *   - `frequent` — what he writes most, starred or not (column «Частые»);
 *   - `starred`  — his stars in his order (column «Мои»);
 *   - `core`     — the clinic's whole core list, the first group of the
 *                  «Каталог» column, each with his own dose when he has one;
 *   - `usual`    — his last dose and schema per catalog drug, so a pick from
 *                  the catalog, the search or the drawer comes back as he
 *                  writes it.
 *
 * «Мой арсенал» (owner request 03.10.2026) adds three more:
 *
 *   - `coreRank`      — the core list's ids in clinic-wide use order: when
 *                       his own «Частые» are fewer than he chose to see,
 *                       the column continues with them;
 *   - `frequentLimit` — his choice on the column's «10 · 20 · 30» switch;
 *   - `starred[i].arsenalSchema` — the schema he set for a drug of his
 *                       arsenal, applied by one click from «Мои».
 *
 * Everything is this doctor's: his notes and their prescription rows in the
 * caller's clinic (the tenant extension scopes those reads), and his own
 * stars, over a bounded window: the last `days` (365), at most 3000 rows and
 * 1000 notes; text lines count for the catalog drug they name. The reads
 * and the ranking live in `loadDoctorDrugLists`
 * (src/server/catalog/doctor-lists.ts), shared with the arsenal page. A
 * structured use whose brand a catalog repair moved to another row
 * («МИОСПАН» from tolperisone to lidocaine + tolperisone, audit CT-03)
 * counts under the row its label names today, see `followMovedBrands`.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok, parseQuery } from "@/server/http";
import { loadDoctorDrugLists } from "@/server/catalog/doctor-lists";

export type {
  DrugShortlistEntry,
  DrugUsualEntry,
} from "@/server/catalog/doctor-lists";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(30).default(12),
  days: z.coerce.number().int().min(7).max(730).default(365),
});

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { limit, days } = parsed.value;

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, frequentDrugLimit: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const lists = await loadDoctorDrugLists({
      doctor: { ...doctor, userId: ctx.userId },
      clinicId: ctx.clinicId,
      days,
      limit,
    });

    // The arsenal page's extras (`arsenal`, `topCatalog`) stay home.
    return ok({
      mine: lists.mine,
      clinic: lists.clinic,
      frequent: lists.frequent,
      starred: lists.starred,
      core: lists.core,
      coreRank: lists.coreRank,
      usual: lists.usual,
      frequentLimit: lists.frequentLimit,
      windowDays: lists.windowDays,
    });
  },
);
