# Folium

> Infinite space.

**v0.1.0** — An infinite canvas for notes, quick task lists, card sorting, free-form text, and pasted images. Opens instantly. No login. No friction. All data stays on your device.

## Features

- **Infinite canvas** — Pan and zoom on a dotted board (FigJam-style background).
- **Elements** — Sticky notes, cards, tasks, FigJam-like text blocks, and **raster images**.
- **Text formatting** — While editing a text block, a floating toolbar offers **font presets**, **size**, **color**, **bold / italic**, and **alignment**. Click outside the text (or the toolbar) to commit; **Escape** closes inline edit without leaving select mode for the whole app.
- **Images** — Drag **JPEG, PNG, WebP, or GIF** from your machine onto the board. Each file up to **5 MB**; images are scaled to a sensible on-canvas size and stored in your saved state (data URLs). Drag selected images to move them like other elements.
- **Navigation** — Scroll/wheel to pan; **⌘/Ctrl + scroll** to zoom toward the cursor; **+ / −** control in the corner.
- **Hand tool** — Hold **Space** to pan with the mouse, including when the pointer is over a selected image or other element (same idea as FigJam). **Middle mouse** also pans, including over elements.
- **Selection** — Click to select, marquee on empty board, resize handles on a single selection, **Delete/Backspace** to remove (when focus is not in an input).
- **Undo / redo** — **⌘/Ctrl+Z** undo; **⌘/Ctrl+⇧Z** redo.
- **Escape** — Switches to the select tool and clears an active marquee.
- **Auto-save** — Debounced save (~400 ms) to IndexedDB.
- **Full restore** — Canvas state reloads after refresh.
- **Encryption** — AES-256-GCM: the serialized canvas is encrypted in the browser before storage; a key is derived locally (no server).
- **Zero backend** — Everything stays local in your browser.
- **Minimal chrome** — Left tool rail ([Lucide](https://lucide.dev/) icons, large tap targets), optional color swatches when placing notes/cards/tasks, save status in a slim top bar (logo only, no product labels), and a footer with version and copyright.
- **Comments (placeholder)** — The comment tool in the rail is disabled until shipped. A short “coming soon” hint appears only when you **hover** the control or **click** it (click again to dismiss if you pinned it open).

## Tech stack

- Vite + React 19 + TypeScript
- **Konva** + react-konva (canvas)
- **Lucide React** (toolbar icons)
- Immer (immutable updates)
- Dexie.js (IndexedDB)
- Web Crypto API (AES-256-GCM)
- Tailwind CSS

## Requirements

- **Node.js** **20.19+** or **22.12+** (required by Vite 8 for `npm run dev` / `npm run build`).

## Getting started

```bash
git clone https://github.com/marcoamodio/folium.git
cd folium
npm install
npm run dev
```

Other scripts: `npm run build` (typecheck + production bundle), `npm run preview`, `npm run lint`.

## Roadmap

- [ ] Export canvas (JSON / PNG)
- [ ] Cloud sync (Phase 2)
- [ ] Account + subscription (Phase 2)

## Author

Marco Amodio

## License

MIT
