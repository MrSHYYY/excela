import { getSessionUser } from "@/lib/auth";
import { sessionPayload, type Session } from "@/lib/session-payload";
import HomeClient from "./components/home-client";

// Reading the session on the server means the very first HTML is already the right page: signed-in
// users get the dashboard immediately instead of a landing page that swaps after a client-side fetch.
export default async function Page() {
  let initialSession: Session | null = null;
  try {
    const current = await getSessionUser();
    initialSession = current ? sessionPayload(current.user) : { authenticated: false };
  } catch {
    // Database unreachable: the browser asks again and shows the error if it still fails.
  }
  return <HomeClient initialSession={initialSession} />;
}
