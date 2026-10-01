/**
 * A tiny evaluator for the Prisma `where` shapes the notification code uses
 * (equality, null, in / notIn, not, gt / gte / lt / lte, AND / OR / NOT), so
 * a test can run a route or a pass against in-memory rows and assert on what
 * it counts, instead of on the query text. Relation filters are not modelled.
 */
type Row = Record<string, unknown>;

const OPS = new Set(["in", "notIn", "not", "gt", "gte", "lt", "lte", "equals"]);

function isOpObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === "object" &&
    !(v instanceof Date) &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0 &&
    Object.keys(v).every((k) => OPS.has(k))
  );
}

function cmp(a: unknown): number | string | null {
  if (a instanceof Date) return a.getTime();
  if (a === null || a === undefined) return null;
  return a as number | string;
}

function matchValue(actual: unknown, expected: unknown): boolean {
  if (isOpObject(expected)) {
    for (const [op, v] of Object.entries(expected)) {
      const a = cmp(actual);
      const b = cmp(v);
      switch (op) {
        case "equals":
          if (a !== b) return false;
          break;
        case "in":
          if (!(v as unknown[]).map(cmp).includes(a)) return false;
          break;
        case "notIn":
          if ((v as unknown[]).map(cmp).includes(a)) return false;
          break;
        case "not":
          if (isOpObject(v)) {
            if (matchValue(actual, v)) return false;
          } else if (a === b) return false;
          break;
        case "gt":
          if (a === null || b === null || !(a > b)) return false;
          break;
        case "gte":
          if (a === null || b === null || !(a >= b)) return false;
          break;
        case "lt":
          if (a === null || b === null || !(a < b)) return false;
          break;
        case "lte":
          if (a === null || b === null || !(a <= b)) return false;
          break;
      }
    }
    return true;
  }
  return cmp(actual) === cmp(expected);
}

export function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    if (key === "AND") {
      if (!(expected as Row[]).every((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(expected as Row[]).some((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (key === "NOT") {
      const list = Array.isArray(expected) ? (expected as Row[]) : [expected as Row];
      if (list.some((w) => matchesWhere(row, w))) return false;
      continue;
    }
    if (!matchValue(row[key], expected)) return false;
  }
  return true;
}
