import { auth } from "@/lib/auth";
import { ChangePasswordClient } from "./_components/change-password-client";

export default async function ChangePasswordPage() {
  const session = await auth();
  // The middleware that forces this page also passes through unauthenticated
  // requests to /api/auth/signin, so the only way you reach this page without
  // a session is by typing the URL directly. Show the form anyway — the API
  // call will 401 and the page won't break.
  const forced = Boolean(session?.user?.mustChangePassword);
  return <ChangePasswordClient forced={forced} />;
}
