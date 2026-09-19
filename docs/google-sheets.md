# Google Sheets sync setup

The **Sync with DOC** button writes extracted events to the existing monthly planner through Google Sheets. Sync uses no AI calls. It uses your Google account's OAuth authorization; no service account is required.

## Google Console setup

1. Enable the Google Sheets API (already done). Drive and Picker APIs are not needed for this fixed-template integration.
2. In Google Auth Platform / Credentials, open your OAuth **Web application** client.
3. Add this exact **Authorized redirect URI**:
   `https://localhost:3000/api/google/callback`
4. Configure the app's consent screen. If its audience is External and publishing status is Testing, add your Google email under **Test users**.
5. Keep `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_SESSION_SECRET` in the root `.env`. The supplied API key is stored as `GOOGLE_API_KEY` but is not used for OAuth or sheet writes. Keep the existing `DOC` URL.
6. Restart your development server yourself, then open `https://localhost:3000`.
7. Click **Connect Google**. A new tab opens for Google sign-in and consent. After connecting, return to the original tab; its connection status refreshes when focused.
8. Extract an announcement, review the JSON, and click **Sync with DOC**.

If Google shows `redirect_uri_mismatch`, check the exact protocol, host, port, path, and OAuth client type. If it blocks a testing app, check the test-user list. You must grant Sheets access and the connected account must be able to edit the template.

## Template mapping

- Month tabs are matched by month and year, for example `Sept 2026`.
- Dates without a year must match exactly one month tab. Otherwise include the year and extract again.
- Displayed day numbers in `D3:D45` identify the target row.
- `course + title` is written as plain text in the first empty cell in E–H on that row.
- Existing values, formulas, and formatting are preserved. Identical labels on that date are skipped.
- All events are checked before a batch write. Full rows or unmatched dates stop the batch.

## Session and deployment

Google tokens are held in an encrypted, HttpOnly, SameSite cookie, never exposed to client JavaScript. Sessions last up to seven days, with access-token refresh while authorized. No database is required. Reconnect if Google revokes or expires authorization.

For Vercel, set the same server-only environment variables and change `GOOGLE_REDIRECT_URI` to `https://YOUR-DOMAIN/api/google/callback`. Register that exact URL with Google. Keep the session secret stable across deployments. Do not use `NEXT_PUBLIC_` for any credentials.

This remains a single-user proof of concept. Avoid simultaneous syncs or editing the same cells while syncing: the read-then-write operation cannot prevent concurrent edits. Retrying checks current sheet contents for duplicates. OAuth connects each browser to its own Google account; it does not restrict the app to a particular user. Use deployment protection before opening this personal planner to others.

No model calls, sheet writes, builds, or tests were run while implementing OAuth. Google Console configuration and user consent must be completed before end-to-end sync can be verified.
