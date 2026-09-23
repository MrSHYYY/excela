# Excela Firefox extension

The popup calls Excela directly. No website or Google Sheets tab needs to stay open. It supports text and Ctrl+V image pasting (one PNG, JPEG or WebP up to 3 MB).

## Update from the tab-based version

1. Deploy the accompanying website changes: `lib/auth.ts`, the AI/sync routes, and the new `/api/extension/session` route. Live mode requires this deployment; reloading only the extension is not enough.
2. In Firefox, open `about:debugging#/runtime/this-firefox` and reload the add-on. If Firefox cannot apply the manifest version/permission changes, remove it and use **Load Temporary Add-on** to select this folder's `manifest.json` again.
3. Approve access to cookies for the two Excela sites. Open the popup and choose **Live** (`https://excela.cfat.site`, default) or **Local** (`https://localhost:3000`). For Local, run the existing HTTPS development server and trust its local certificate in Firefox.
4. Sign in and complete setup through the website once in the same normal Firefox profile. You may then close every Excela/Sheets tab. A Chrome, private-window, or container-specific login is not used by this version.
5. Type or paste a screenshot and press Enter / Inject. Shift+Enter adds a new line. Signed-out users see a sign-in prompt instead of input fields.

There is no extension build step. Temporary add-ons are removed when Firefox restarts; load the manifest again until the extension is signed for permanent installation.

## Behavior

- First install opens the website for onboarding. Subsequent popup opens create no tabs. Only explicit sign-in/setup or website buttons open a tab.
- Sign-in is checked through the existing `excela_session` cookie using Firefox's privileged cookies API. It is sent only to the selected Excela origin as a bearer token, never to AI providers or to the popup. The server verifies its hash, expiration, and account on each AI/sync request. Invalid bearer headers never fall back to cookie authentication. Website cookie requests retain their origin checks.
- The API key stays encrypted in the account database. The extension stores only the selected site preference on disk. Account status is cached in background memory for up to 60 seconds, invalidated by login-cookie changes; injection routes always authenticate on the server.
- The skeleton appears during an uncached account check. Reopening the popup uses the short cache; job progress polls background memory without repeatedly querying the database.
- Firefox desktop Manifest V2 provides a persistent background page, allowing injection to continue when the popup or website tabs close. Closing Firefox or reloading/removing the extension interrupts background work; check the sheet before retrying an interrupted write.
- Events go to the planner selected in setup, never an arbitrary currently open sheet. Live and Local never fall back to one another. Switching clears the draft/image. Drafts and images disappear when the popup closes.
- Website sessions still expire normally. Sign out on the website to revoke the corresponding session. After changing setup, account labels may take up to a minute to refresh, but the server uses the current saved planner and key.

Only the two listed HTTPS hosts are allowed. Firefox match patterns cannot restrict localhost ports, so the code allows only port 3000. No tab scripting, content scripts, or Sheets-page access is used.

## Release status

This is an unsigned Firefox desktop add-on. Public distribution still requires Mozilla privacy/data-transmission declarations, validation, and signing. No Chrome compatibility is claimed. Runtime checks and live AI calls require the project owner's approval.
