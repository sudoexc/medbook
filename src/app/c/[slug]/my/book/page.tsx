import { redirect } from "next/navigation";

export default async function BookRoot({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  // Keep `?onBehalfOf=` (and any other context) on the way into the wizard:
  // dropping it books a relative's visit on the owner's card (audit MA-02).
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") sp.set(key, value);
  }
  const qs = sp.toString();
  redirect(`/c/${slug}/my/book/service${qs ? `?${qs}` : ""}`);
}
