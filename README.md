# Folium
> Infinite space.

An infinite canvas for notes, quick task lists, and card sorting.
Opens instantly. No login. No friction.

## Features
- Infinite canvas powered by tldraw
- Auto-save with debounce (400ms)
- Full restore on refresh via IndexedDB
- AES-256-GCM encryption — all data encrypted client-side
- Zero backend — everything lives in your browser
- Minimal top bar with live save status indicator

## Tech stack
- Vite + React + TypeScript
- tldraw
- Dexie.js (IndexedDB)
- Web Crypto API (AES-256-GCM)
- TailwindCSS

## Getting started
git clone https://github.com/marcoamodio/folium.git
cd folium
npm install
npm run dev

## Roadmap
- [ ] AES-256-GCM encryption (in progress)
- [ ] Export canvas (JSON / PNG)
- [ ] Cloud sync (Phase 2)
- [ ] Account + subscription (Phase 2)

## License
MIT