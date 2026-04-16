# Privacy Policy

**Last updated: April 2026**

## The short version

Folium does not collect, store, transmit, or have access to any of your data.
Everything you create stays on your device. We have no servers that receive
your content. We do not know you exist.

## How Folium works

Folium is a local-first application. It runs entirely inside your browser.

- All canvas data is saved in your browser's IndexedDB, encrypted with AES-256
- The encryption key never leaves your device
- No data is ever sent to any server — not ours, not anyone else's
- There is no account, no login, no registration of any kind
- There are no cookies
- There are no analytics, tracking pixels, or telemetry of any kind

Your canvas is your private workspace. It belongs entirely to you.

## What data exists and where

| Data | Where it lives | Who can access it |
|---|---|---|
| Canvas content | Your browser's IndexedDB, encrypted | Only you |
| Encryption key | Derived at runtime, never stored in plaintext | Only your browser session |
| Usage patterns | Not collected | Nobody |
| IP address | Not logged by us | Nobody |

## Images

Images added to the canvas are converted to local data URLs and stored
on your device. Folium does not accept remote image URLs and makes no
external network requests to load images.

## Export and import (upcoming)

When export is available, saving your canvas produces a file on your device —
like saving a document in a word processor. That file is yours.
Folium has no access to it and keeps no copy.

## Hosting

The app is served via Vercel/Netlify. Standard web hosting logs
(IP address, timestamp, browser type) may be retained by the hosting
provider under their own privacy policy. Folium has no access to these
logs and does not use them.

## GDPR

Because Folium does not collect or process personal data, it does not act
as a data controller or processor under the GDPR. There is nothing to
request, correct, or delete on our side.

## Open source

Folium is open source. You can inspect exactly how it works:
https://github.com/marcoamodio/folium

## Contact

Questions? Open an issue on the GitHub repository.
