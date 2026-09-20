# Google planner access

Excela requests `openid`, `email`, `profile`, and
`https://www.googleapis.com/auth/drive.file`. It no longer requests the broad
`spreadsheets` scope. Keep Google Drive API, Google Sheets API, and Google Picker
API enabled in the same Cloud project as the OAuth client.

## Cloud configuration

- In Google Auth Platform → Data Access, replace the `spreadsheets` scope with
  `drive.file`. Keep the identity scopes.
- Keep the callback URL registered exactly as `GOOGLE_REDIRECT_URI` specifies.
  Register the app's origin under the web OAuth client's JavaScript origins.
- Set `GOOGLE_PICKER_API_KEY` to a browser key in that same project, restricted to
  Google Picker API. Restrict website referrers to the deployed app, the actual
  localhost origin used for development, and `https://docs.google.com/*` (Picker's
  iframe). This key is intentionally sent to the browser; do not use an AI key.
- Set `GOOGLE_PROJECT_NUMBER` to the numeric project number. The OAuth client's
  numeric prefix is used if this variable is omitted.
- Configure these variables in Vercel too, then redeploy. Local changes to `.env`
  may require restarting the development server.

## Generate template and Inject

`TEMPLATE_SHEET_URL` identifies the public master Google Sheet. Enable anyone-with-
the-link viewing and allow viewers to download it. The server downloads an Excel
export without user credentials, then uses Drive's import conversion to create a
native Google Sheet called **Excela Planner** in the signed-in user's Drive.
The new file is authorized for Excela because the app creates it. The saved
planner ID is used for later Inject operations through the Sheets API.

The import currently supports template exports up to 5 MB. Google-specific
features can differ after Excel conversion; check the generated calendar's tabs,
formulas, formatting, and date cells before relying on it. No AI call is used to
create the planner or write events.

## Existing planners and users

Use **Choose from Google Drive** to authorize an existing editable Google Sheet.
Pasting a URL alone does not grant `drive.file` access. The server checks editing
permission and month tabs before saving the selection.

Existing Excela sessions prompt users to reconnect because their stored grant
does not yet include `drive.file`. Their saved planner links remain intact.
If the saved planner cannot be accessed, choose it through Picker once.

Requesting a narrower scope does not revoke old grants. For a clean migration,
remove Excela from https://myaccount.google.com/connections, reconnect in Excela,
and select the existing planner again. This does not delete the planner.

Picker receives a short-lived access token in browser memory. Refresh tokens,
OAuth client secrets, and the Ollama key remain on the server.

## Verification to run with approval

1. Reconnect after removing the old grant; check the consent screen.
2. Generate a template and inspect its calendar layout and dates in Drive.
3. Select an existing planner through Picker; confirm selection and cancellation.
4. Inject a dated event, verify the target cell and dark red/white formatting,
   then retry the sync to confirm duplicate handling.

References: [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker),
[Drive import conversion](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
