# Excela Firefox extension

The popup is a compact chat with your Excela planner agent. No website or Google Sheets tab needs to stay open.

## Update from the extraction/Inject version

1. This version talks to `/api/agent` (Excela Smart) instead of `/api/ai` + `/api/sync`. Deploy the current website first; older deployments without `/api/agent` will fail with a clear error.
2. In Firefox, open `about:debugging#/runtime/this-firefox` and reload the add-on. If Firefox cannot apply the manifest version/permission changes (this version adds `activeTab` for the optional page-context toggle), remove it and use **Load Temporary Add-on** to select this folder's `manifest.json` again.
3. Approve access to cookies for the two Excela sites. Open the popup and choose **Live** (`https://excela.cfat.site`, default) or **Local** (`https://localhost:3000`). For Local, run the existing HTTPS development server and trust its local certificate in Firefox.
4. Sign in and complete setup through the website once in the same normal Firefox profile. You may then close every Excela/Sheets tab.
5. Type a message and press Enter, or the send button. Shift+Enter adds a new line. Signed-out or not-yet-set-up users see a sign-in/setup prompt instead of the chat.

There is no extension build step. Temporary add-ons are removed when Firefox restarts; load the manifest again until the extension is signed for permanent installation.

## Behavior

- Ask naturally: "What do I have today?", "What's on tomorrow?", "Add CSE340 quiz Friday at 10am", "Find my CSE340 quiz". The popup shows Excela's actual reply, plus small chips naming any planner tool it used (e.g. `get_today_schedule`, `create_event`) so it's clear when something in your sheet actually changed versus when it was just answering a question.
- **Include this page**: an optional checkbox that attaches the current tab's title and URL to your next message (for example, an assignment page), so you can say "add this to my planner" while looking at it. It captures only the title and URL via the `activeTab` permission — never the page's content — and only when you check the box for that message. It's unavailable on browser-internal pages.
- **New chat** (the ＋ button) clears the conversation shown in the popup and the history sent to the agent. Nothing in your planner is undone by this — it only resets the conversation.
- Conversation history is kept in the background's memory only (never written to disk), per selected site, and is cleared automatically if the signed-in Excela account changes, so one Google account can never see another's chat.
- First install opens the website for onboarding. Subsequent popup opens create no tabs. Only explicit sign-in/setup or website buttons open a tab.
- Sign-in is checked through the existing `excela_session` cookie using Firefox's privileged cookies API. It is sent only to the selected Excela origin as a bearer token, never to the AI provider or to the popup. The server verifies its hash, expiration, and account on each request.
- The Ollama API key stays encrypted in the account database and is never sent to or stored by the extension. The extension stores only the selected site preference on disk. Account status is cached in background memory for up to 60 seconds, invalidated by login-cookie changes.
- Firefox desktop Manifest V2 provides a persistent background page, so a reply keeps coming even if you close the popup. Closing Firefox or reloading/removing the extension interrupts it; reopen the popup afterward to see what did or didn't complete.
- Only the two listed HTTPS hosts are allowed. Firefox match patterns cannot restrict localhost ports, so the code allows only port 3000. No content scripts or Sheets-page access are used; the page-context feature reads only `tab.title`/`tab.url` through `activeTab`.

## Release status

This is an unsigned Firefox desktop add-on. Public distribution still requires Mozilla privacy/data-transmission declarations, validation, and signing. Runtime checks and live AI calls require the project owner's approval.
