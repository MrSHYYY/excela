# Excela Firefox extension

No dependencies or extension build step. Use **Connect to** in the popup to choose **Live** (https://excela.cfat.site, the default) or **Local** (https://localhost:3000). The extension remembers your choice. Each site uses its own Firefox login session. Switching sites clears the draft and image; requests never automatically fall back to the other site.

## Load in Firefox

1. For Live, use the deployed website. For Local, have Excela running at https://localhost:3000 and accept its development certificate in Firefox if needed.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select this folder's **manifest.json**.
4. Installation opens Excela. Sign in and complete your planner/API setup in Firefox (a Chrome login does not carry over).
5. Leave the Excela tab open. Open your Google Sheet and click Excela in Firefox's extensions menu. Pin it to the toolbar if desired.
6. Enter an announcement, choose General or Academic, and click **Inject** or press **Enter**. Shift+Enter inserts a new line.

The popup shows connection, progress, success, declined input, and errors. Reopening it during injection shows the ongoing job. You may close the popup while working, but **do not close or reload the dedicated Excela tab during injection**. If interrupted, check your sheet before retrying. Draft text is not saved after the popup closes.

## Account and privacy

The extension uses the website's existing signed-in session through an isolated script in a dedicated Excela tab. It calls the existing status, AI, and sync routes. Your API key stays encrypted in the existing database and is only used by Excela's server. No additional OAuth client, backend, database, or login is needed.

Events always go into the planner selected in your Excela setup, **not whichever spreadsheet is currently open**. The extension does not read Google Sheets pages. Host permissions cover only https://excela.cfat.site and HTTPS localhost. Firefox match patterns cannot restrict a port, so the code restricts localhost to port 3000. Only the selected origin receives requests. Website origin checks and cookies are unchanged. Extension storage saves only your site preference.

The popup supports text and screenshot pasting with Ctrl+V in the input. Attach one PNG, JPEG, or WebP up to 3 MB; text is optional when an image is attached. Preview, replace, or remove the image before injecting. Attachments stay in memory and are discarded when the popup closes. No announcement history, API keys, or account credentials are saved in extension storage. Firefox removes temporary add-ons when it restarts; load manifest.json again. After code edits, use **Reload** on the add-on's debugging card and reload the dedicated Excela tab when no injection is running.

The live domain is configured. Deploy the current website/API code there before using Live. This is still an unsigned add-on: Mozilla privacy declarations, release validation, and signing are required before public distribution. After updating, reload the add-on and refresh its Excela tab while no injection is running; approve the added site permission if Firefox asks.
