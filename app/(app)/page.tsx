import { getSessionUser } from "@/lib/auth";
import { sessionPayload, type Session } from "@/lib/session-payload";
import HomeClient from "@/app/components/home-client";

export default async function Page() {
  let initialSession: Session | null = null;
  try {
    const current = await getSessionUser();
    initialSession = current ? sessionPayload(current.user) : { authenticated: false };
  } catch {
    // Database unreachable
  }
  return <HomeClient initialSession={initialSession} />;
}
