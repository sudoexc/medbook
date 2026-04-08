import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

  const body = await request.json();
  const review = await prisma.review.create({
    data: {
      authorName: body.authorName,
      rating: body.rating,
      text: body.text,
      source: body.source || "manual",
      sourceUrl: body.sourceUrl || null,
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
      visible: body.visible ?? true,
    },
  });
  return Response.json(review);
}

// PATCH /api/reviews — admin: update review
export async function PATCH(request: Request) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { id, ...data } = body;

  if (data.publishedAt) data.publishedAt = new Date(data.publishedAt);

  const review = await prisma.review.update({ where: { id }, data });
  return Response.json(review);
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
