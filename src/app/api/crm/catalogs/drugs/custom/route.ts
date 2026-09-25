/**
 * POST /api/crm/catalogs/drugs/custom — a doctor adds a drug the catalog
 * does not have, and it joins the clinic's base for EVERY doctor.
 *
 * The clinic's request (25.09.2026): some doctors never add anything
 * themselves, so what one colleague adds must show up for all of them. The
 * old «Свой препарат» only wrote a free-text line into one visit; the next
 * doctor searched and found nothing.
 *
 * Deliberately forgiving: the doctor types a name mid-visit. If the catalog
 * (global rows, this clinic's rows, brand names, the clinic's core-list
 * names) already has that exact name, the existing drug is returned instead
 * of a duplicate. Otherwise a clinic-owned Drug row is created. Its `inn` is
 * a private key («clinic:…») — the UI hides it, like the register's «uzr:».
 *
 * Guards: a drug the ADMIN hid or retired under that name is NOT recreated
 * behind his back (409 `hidden_by_clinic`); ids are ASCII so every
 * /drugs/[id] route can address the row; DOCTOR/ADMIN only, 3+ letters, and
 * a per-user hourly cap so a stuck key cannot flood the shared base.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { rateLimit } from "@/lib/rate-limit";
import { err, forbidden, ok } from "@/server/http";
import { loadClinicOverlays } from "@/server/catalog/clinic-overlay";
import {
  loadFormulary,
  normalizeCatalogTerm,
  stripDoseFromName,
} from "@/server/catalog/formulary";
import { loadDrugHits } from "@/server/catalog/drug-hits";

const BodySchema = z.object({
  name: z.string().trim().min(3).max(120),
});

const ADDS_PER_HOUR = 30;

export const POST = createApiHandler(
  { roles: ["DOCTOR", "ADMIN"], bodySchema: BodySchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const name = body.name.replace(/\s+/g, " ").trim();
    // «Конкор 5» is Конкор: match on the name without the dose too.
    const bare = stripDoseFromName(name);
    const names = [...new Set([name, bare].filter((n) => n.length >= 2))];
    const keys = names.map(normalizeCatalogTerm);

    const [formulary, overlays] = await Promise.all([
      loadFormulary(),
      loadClinicOverlays(ctx.clinicId, "DRUG"),
    ]);

    // 1. Already there under this exact name? Looked up among retired and
    //    hidden rows too: those are an ADMIN decision, not a gap to refill.
    const byName = await prisma.drug.findMany({
      where: {
        OR: [{ clinicId: null }, { clinicId: ctx.clinicId }],
        AND: [
          {
            OR: names.flatMap((n) => [
              { nameRu: { equals: n, mode: "insensitive" as const } },
              {
                brands: {
                  some: { name: { equals: n, mode: "insensitive" as const } },
                },
              },
            ]),
          },
        ],
      },
      // The clinic's own row first, then the curated/global one.
      orderBy: [{ clinicId: { sort: "desc", nulls: "last" } }, { nameRu: "asc" }],
      select: { id: true, active: true, clinicId: true },
      take: 10,
    });
    const usable = byName.find(
      (d) => d.active && !(d.clinicId === null && overlays.hidden.has(d.id)),
    );
    if (!usable && byName.length > 0) {
      return err("DrugHiddenByClinic", 409, { reason: "hidden_by_clinic" });
    }
    const byAlias = usable
      ? null
      : formulary.find(
          (f) =>
            keys.includes(normalizeCatalogTerm(f.label)) ||
            f.aliases.some((a) => keys.includes(normalizeCatalogTerm(a))),
        );
    const existingId = usable?.id ?? byAlias?.drugId ?? null;
    if (existingId) {
      const hits = await loadDrugHits([existingId], ctx.clinicId, formulary);
      const drug = hits.get(existingId);
      if (drug) return ok({ drug, created: false });
    }

    // 2. New clinic drug, visible to every doctor of the clinic.
    if (!rateLimit(`drug-add:${ctx.userId}`, ADDS_PER_HOUR, 3_600_000)) {
      return err("TooManyRequests", 429, { reason: "drug_add_rate_limited" });
    }
    let row: { id: string } | null = null;
    for (let attempt = 0; attempt < 3 && !row; attempt += 1) {
      // ASCII only: the /drugs/[id] routes read the raw URL path, and a
      // Cyrillic id arrives percent-encoded and never matches.
      const uid = randomUUID();
      try {
        row = await prisma.drug.create({
          data: {
            id: `clinic-${uid}`,
            inn: `clinic:${ctx.clinicId}:${uid}`,
            nameRu: name,
            category: "OTHER",
            forms: [] as Prisma.InputJsonValue,
            rxOnly: true,
            clinicId: ctx.clinicId,
          },
          select: { id: true },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          continue;
        }
        throw e;
      }
    }
    if (!row) return err("DrugCreateFailed", 500);

    await audit(request, {
      action: AUDIT_ACTION.KNOWLEDGE_DRUG_CREATED,
      entityType: "Drug",
      entityId: row.id,
      meta: { nameRu: name, source: "doctor_quick_add" },
    });

    const hits = await loadDrugHits([row.id], ctx.clinicId, formulary);
    return ok({ drug: hits.get(row.id) ?? null, created: true }, 201);
  },
);
