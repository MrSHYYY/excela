# Excela
Your sheet, powered by AI.

Excela turns a class announcement into events and writes them into your own monthly planner in Google Sheets. Users sign in with **Google only**; each user saves their planner link once and it is stored in MongoDB.

## Setup

1. Install the MongoDB driver once: `npm install mongodb`.
2. Copy `.env.example` to `.env` and fill it in. `MONGODB_URI` must end the host list with `/Excela`, which is the database name. There is no `DOC` variable: each user's sheet link is saved in MongoDB.
3. In MongoDB Atlas → Network Access, allow your IP address.
4. In Google Auth Platform → Credentials, open your OAuth **Web application** client and add the redirect URI `https://localhost:3000/api/google/callback`.
5. On the consent screen, configure the scopes `openid`, `email`, `profile` and Google Sheets (`.../auth/spreadsheets`). While the app is External and in Testing, add each user's Google email under **Test users**.
6. Run `npm run dev` and open `https://localhost:3000`.

## How sign-in works

1. **Continue with Google** starts the OAuth authorization code flow with PKCE and a `state` check.
2. `/api/google/callback` verifies the ID token (verified email required) and the Sheets scope, then creates or updates the user in MongoDB and starts a server-side session. The browser only holds a random token in an HttpOnly cookie (30 days, renewed on visits).
3. On first sign-in the user pastes their planner link. Excela checks it with the user's own Google access and saves it on their user document. It can be changed later.
4. The AI and sync endpoints require a signed-in user. Sync uses that user's saved sheet and their stored Google refresh token.

## MongoDB (database `Excela`)

- `users`: `googleId` (unique), `email`, `name`, `picture`, `refreshToken` (AES-256-GCM encrypted with `GOOGLE_SESSION_SECRET`), `sheetUrl`, `sheetId`, `sheetTitle`, timestamps.
- `sessions`: hash of the session token, `userId`, `expiresAt`. A TTL index removes expired sessions.

Collections and indexes are created automatically on first use. Changing `GOOGLE_SESSION_SECRET` makes stored refresh tokens unreadable, so users would need to sign in again.

## Generate template and delete account

- **Generate template**: on the planner-link form, users without a planner can click it. Excela creates a new spreadsheet in the user's own Google Drive, copies every tab of the template from `TEMPLATE_SHEET_URL` into it, and saves it as their planner. The template must be shared as "Anyone with the link can view" so every user's Google account can read it. Uses only the Sheets permission the user already granted.
- **Delete account**: removes the user's `users` document and all their `sessions` from MongoDB, revokes Excela's Google access, and signs them out. Their Google Sheets (including a generated planner) stay in their own Google account.

## Planner template

- Month tabs are matched by month and year, for example `Sept 2026`.
- Dates without a year must match exactly one month tab. Otherwise include the year and extract again.
- Displayed day numbers in `D3:D45` identify the target row.
- `course + title` is written as plain text in the first empty cell in E–H on that row.
- New event cells get a dark red background (#991B1B) and white text; other formatting is preserved. Existing values and formulas are never overwritten, and identical labels on that date are skipped.
- All events are checked before a batch write. Full rows or unmatched dates stop the batch.

## Troubleshooting

- `redirect_uri_mismatch`: check the exact protocol, host, port and path registered for the OAuth client.
- Google blocks sign-in for a testing app: add the account under **Test users**.
- "Could not reach the database": check `MONGODB_URI`, the database user's password and Atlas Network Access.
- Refresh tokens for External apps in **Testing** expire after seven days, after which Excela shows "Sign in with Google again". Setting the publishing status to **In production** removes this limit ([details](https://developers.google.com/identity/protocols/oauth2#expiration)).

## Deployment

Set the same server-only environment variables, change `GOOGLE_REDIRECT_URI` to `https://YOUR-DOMAIN/api/google/callback`, and register that exact URL with Google. Keep `GOOGLE_SESSION_SECRET` stable across deployments. Avoid simultaneous syncs on the same sheet: the read-then-write operation cannot prevent concurrent edits, but retries skip duplicates.
