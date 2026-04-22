// @ts-nocheck
// TODO(phase-1): rewrite — legacy Prisma schema mismatch, owned by api-builder/prisma-owner.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ReviewCreateSchema = z.object({
  authorName: z.string().min(1).max(120),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(1).max(2000),
  source: z.string().max(50).optional(),
  sourceUrl: z.string().url().max(500).optional().nullable(),
  publishedAt: z.string().datetime().optional(),
  visible: z.boolean().optional(),
});

const ReviewUpdateSchema = ReviewCreateSchema.partial().extend({
  id: z.string().min(1),
});

// GET /api/reviews — public: visible reviews; admin: all reviews
export async function GET(request: Request) {
  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "true";

  if (all) {
    const session = await auth();
    if (session?.user?.role !== "ADMIN") {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const reviews = await prisma.review.findMany({ orderBy: { publishedAt: "desc" } });
    return Response.json(reviews);
  }

  const reviews = await prisma.review.findMany({
    where: { visible: true },
    orderBy: { publishedAt: "desc" },
    take: 20,
  });
  return Response.json(reviews);
}

// POST /api/reviews — admin: create review
export async function POST(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ReviewCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const d = parsed.data;

  try {
    const review = await prisma.review.create({
      data: {
        authorName: d.authorName,
        rating: d.rating,
        text: d.text,
        source: d.source || "manual",
        sourceUrl: d.sourceUrl || null,
        publishedAt: d.publishedAt ? new Date(d.publishedAt) : new Date(),
        visible: d.visible ?? true,
      },
    });
    return Response.json(review, { status: 201 });
  } catch (err) {
    console.error("[reviews] create failed", err);
    return Response.json({ error: "Failed to create review" }, { status: 500 });
  }
}

// PATCH /api/reviews — admin: update review
export async function PATCH(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ReviewUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { id, publishedAt, ...rest } = parsed.data;

  try {
    const review = await prisma.review.update({
      where: { id },
      data: {
        ...rest,
        ...(publishedAt ? { publishedAt: new Date(publishedAt) } : {}),
      },
    });
    return Response.json(review);
  } catch (err) {
    console.error("[reviews] update failed", err);
    return Response.json({ error: "Failed to update review" }, { status: 500 });
  }
}

// DELETE /api/reviews — admin: delete review
export async function DELETE(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });

  await prisma.review.delete({ where: { id } });
  return Response.json({ ok: true });
}
