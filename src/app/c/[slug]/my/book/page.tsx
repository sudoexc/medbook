import { redirect } from "next/navigation";

export default async function BookRoot({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/c/${slug}/my/book/service`);
}
