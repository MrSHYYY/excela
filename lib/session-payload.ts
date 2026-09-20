import { decrypt } from "@/lib/crypto";
import { driveFileScope } from "@/ai/google-auth";
import type { UserDoc } from "@/lib/models";

/** What the browser is told about the signed-in user. Never includes tokens. */
export type Session =
  | { authenticated: false }
  | {
      authenticated: true;
      user: { name: string; email: string; picture: string | null };
      sheet: { url: string; title: string } | null;
      googleAccess: boolean;
    };

export function sessionPayload(user: UserDoc): Session {
  return {
    authenticated: true,
    user: { name: user.name, email: user.email, picture: user.picture },
    sheet: user.sheetId && user.sheetUrl ? { url: user.sheetUrl, title: user.sheetTitle ?? "Planner" } : null,
    googleAccess: Boolean(user.googleScopes?.includes(driveFileScope) && user.refreshToken && decrypt(user.refreshToken)),
  };
}
