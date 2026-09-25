# Excela Chrome extension

This is the Chrome Manifest V3 version of Excela Quick Inject. It supports the same Live and Local environments as the Firefox extension, including Google-session authentication, announcement text or image paste, General/Academic pipelines, planner injection, duplicate skipping, and completion/uncompletion commands.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this `extension/chrome` folder.
4. Sign in and complete setup on the selected Excela site, then open the extension popup.

Deploy the updated Excela website before using Live mode. Local mode requires the existing HTTPS development server and a trusted local certificate.

The service worker keeps the same in-memory job behavior as the Firefox background page while Chrome is running. Reloading/removing the extension or shutting down Chrome interrupts an active injection; check the planner before retrying.
