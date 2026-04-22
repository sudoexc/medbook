import { redirect } from "next/navigation"

export default async function CrmIndex({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/crm/reception`)
}
