import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { sessionPayload } from "@/lib/session-payload";
import TelegramClient from "@/app/components/telegram-client";

export const metadata: Metadata = { title: "Telegram Connection | Excela" };

export default async function TelegramPage() {
  const current = await getSessionUser();
  if (!current) redirect("/");
  const session = sessionPayload(current.user);
  if (!session.authenticated) redirect("/");
  return <TelegramClient initialSession={session} />;
}
