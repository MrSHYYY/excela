import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieOptions, googleClient, sheetsScope } from "@/ai/google-auth";

export async function GET() {
  try {
    const client = googleClient();
    const state = randomBytes(32).toString("hex");
    (await cookies()).set("excela_google_state", state, cookieOptions(600));
    return NextResponse.redirect(client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [sheetsScope],
      state,
    }));
  } catch {
    return Response.json({ error: "Set Google OAuth credentials, redirect URI, and session secret in .env." }, { status: 503 });
  }
}
