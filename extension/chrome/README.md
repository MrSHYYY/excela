# Excela Chrome extension

This is the Chrome Manifest V3 version of Excela: a compact chat popup that talks to your Excela planner agent (`/api/agent`), matching the Firefox extension's behavior and design. It supports the same Live and Local environments, Google-session authentication, and an optional "include this page" toggle for the active tab's title/URL.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this `extension/chrome` folder.
4. Sign in and complete setup on the selected Excela site, then open the extension popup.

Deploy the updated Excela website (with `/api/agent` and `/api/extension/session`) before using Live mode. Local mode requires the existing HTTPS development server and a trusted local certificate.

## Behavior

See `extension/firefox/README.md` for the full behavior notes — chat, tool chips, "Include this page", "New chat", and session/security details — which apply identically here. The one structural difference is that Chrome's Manifest V3 uses a `background.service_worker` instead of Firefox's persistent background page; an in-flight reply keeps the service worker alive, but Chrome may still terminate it if the browser itself closes or the extension is reloaded, interrupting a reply in progress. Reopen the popup afterward to see what did or didn't complete, and check your planner before retrying a request you're unsure about.
