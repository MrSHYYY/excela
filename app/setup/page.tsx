import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sessionPayload } from "@/lib/session-payload";
import SetupClient from "../components/setup-client";

export const metadata: Metadata = { title: "Setup | Excela" };

export default async function SetupPage() {
  const current = await getSessionUser();
  if (!current) redirect("/");
  const session = sessionPayload(current.user);
  if (!session.authenticated) redirect("/");
  return <SetupClient initialSession={session} />;
}
