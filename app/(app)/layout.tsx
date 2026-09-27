import { getSessionUser } from "@/lib/auth";
import { sessionPayload, type Session } from "@/lib/session-payload";
import { AuthProvider } from "@/app/components/auth-context";
import AuthenticatedShell from "@/app/components/authenticated-shell";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initialSession: Session | null = null;
  try {
    const current = await getSessionUser();
    initialSession = current ? sessionPayload(current.user) : { authenticated: false };
  } catch {
    // Database unreachable
  }

  return (
    <AuthProvider initialSession={initialSession}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </AuthProvider>
  );
}
