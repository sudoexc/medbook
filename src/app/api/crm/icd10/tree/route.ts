/**
 * GET /api/crm/icd10/tree?node=G40-G47 — one level of the ICD-10 tree for
 * the visit screen's «Каталог МКБ» column (clinic request 03.10.2026: the
 * diagnosis picked with the mouse, chapter → block → code). A chapter or a
 * block answers with its child blocks and the codes outside them; see
 * `@/server/icd10/tree` for why a node can hold both.
 *
 * Static reference data, no tenant rows: the same answer for every clinic,
 * cached by the browser for the session.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { err, ok, parseQuery } from "@/server/http";
import { icd10Node, RANGE_SHAPE } from "@/server/icd10/tree";

const QuerySchema = z.object({
  node: z.string().trim().toUpperCase().regex(RANGE_SHAPE),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const node = icd10Node(parsed.value.node);
    if (!node) return err("UnknownNode", 404);
    return ok(node);
  },
);
