import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, deleteSession, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Sign out must be requested from the Excela page." }, { status: 403 });
  await deleteSession((await cookies()).get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
