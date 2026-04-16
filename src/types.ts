import { base64ToBytes } from './crypto'

export type ElementKind =
  | 'note'
  | 'task'
  | 'card'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'text'
  | 'image'
  | 'pencil'
  | 'folder'
  | 'comment'

/** Konva Text.fontStyle values we persist for the text tool. */
export type TextFontStyleKonva =
  | 'normal'
  | 'italic'
  | 'bold'
  | 'bold italic'

export type TextAlignKonva = 'left' | 'center' | 'right'

export interface CanvasElement {
  id: string
  kind: ElementKind
  x: number
  y: number
  width: number
  height: number
  text: string
  /** Fill (note/card) or left accent bar color (task). */
  color: string
  /**
   * `kind === 'pencil'`: polyline points in local coords relative to (x,y),
   * as `[x1,y1,x2,y2,...]` in world pixels.
   */
  points?: number[]
  /** `kind === 'pencil'`: stroke width in world px. */
  strokeWidth?: number
  /**
   * Raster image as data URL (`image/jpeg` | `png` | `webp` | `gif`).
   * Present only when `kind === 'image'`.
   */
  imageSrc?: string
  /** `kind === 'text'`: font size in px (clamped when read). */
  fontSize?: number
  /** `kind === 'text'`: CSS font-family stack (see `TEXT_FONT_PRESETS`). */
  fontFamily?: string
  /** `kind === 'text'`: Konva `fontStyle` (whole block). */
  fontStyle?: TextFontStyleKonva
  /** `kind === 'text'`: horizontal alignment. */
  textAlign?: TextAlignKonva
  /** When set, element is inside a folder (not drawn on the main board). */
  parentFolderId?: string
}

/** Default text tool font size (px). */
export const TEXT_FONT_SIZE_DEFAULT = 14

const TEXT_SIZE_LABELS = [
  'Small',
  'Medium',
  'Large',
  'Larger',
  'Extra large',
  'Huge',
  'Max',
] as const

/** Pixel sizes for the text tool (toolbar + layout). */
export const TEXT_FONT_SIZES = [12, 14, 16, 18, 20, 24, 32] as const

/** FigJam-style size labels (paired with `TEXT_FONT_SIZES`). */
export const TEXT_SIZE_OPTIONS = TEXT_FONT_SIZES.map((px, i) => ({
  px,
  label: TEXT_SIZE_LABELS[i] ?? `${px}px`,
}))

/**
 * Text-tool fonts: browser/system stacks only (no webfont loading).
 * Times, typewriter-style, Courier, generic UI sans (not Inter).
 */
export const TEXT_FONT_PRESETS = [
  {
    id: 'times',
    label: 'Times New Roman',
    family: 'Times New Roman, Times, serif',
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    family:
      'American Typewriter, Lucida Console, Courier New, Courier, monospace',
  },
  {
    id: 'courier',
    label: 'Courier',
    family: 'Courier New, Courier, monospace',
  },
  {
    id: 'system',
    label: 'System UI',
    family:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
] as const

/** `fontFamily` values allowed when loading persisted state (toolbar presets only). */
export const ALLOWED_FONT_FAMILIES = new Set<string>(
  TEXT_FONT_PRESETS.map((p) => p.family),
)

/** Max length for a data-URL image (~10MB encoded). */
export const MAX_IMAGE_SRC_STRING_LENGTH = 14_000_000

function magicMatchesImageMime(mime: string, bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const m = mime.toLowerCase()
  if (m === 'jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (m === 'png') {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    )
  }
  if (m === 'gif') {
    return (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    )
  }
  if (m === 'webp') {
    if (bytes.length < 12) return false
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
  }
  if (m === 'svg+xml') {
    const txt = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, Math.min(bytes.length, 256 * 1024)),
    )
    const t = txt.trimStart()
    return /^(<\?xml\b|<svg\b)/i.test(t)
  }
  return false
}

/**
 * Accepts only safe local data URLs for raster/SVG images (no remote URLs).
 * Optionally verifies base64 payload magic bytes for jpeg, png, gif, webp, svg+xml.
 */
export function isValidImageSrc(src: string): boolean {
  if (typeof src !== 'string' || src.length > MAX_IMAGE_SRC_STRING_LENGTH) {
    return false
  }
  const m = src.match(
    /^data:image\/(jpeg|png|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)$/i,
  )
  if (!m) return false
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(base64ToBytes(m[2]!))
  } catch {
    return false
  }
  return magicMatchesImageMime(m[1]!, bytes)
}

export function defaultTextFontFamily(): string {
  return TEXT_FONT_PRESETS[0].family
}

export function resolveTextFontSize(
  el: Pick<CanvasElement, 'kind' | 'fontSize'>,
): number {
  if (el.kind !== 'text') return TEXT_FONT_SIZE_DEFAULT
  const n = el.fontSize
  if (typeof n === 'number' && Number.isFinite(n)) {
    return Math.min(96, Math.max(8, Math.round(n)))
  }
  return TEXT_FONT_SIZE_DEFAULT
}

export function resolveTextFontFamily(
  el: Pick<CanvasElement, 'kind' | 'fontFamily'>,
): string {
  if (el.kind !== 'text') return defaultTextFontFamily()
  const f = el.fontFamily
  if (typeof f === 'string' && ALLOWED_FONT_FAMILIES.has(f)) return f
  return defaultTextFontFamily()
}

export function resolveTextFontStyle(
  el: Pick<CanvasElement, 'kind' | 'fontStyle'>,
): TextFontStyleKonva {
  if (el.kind !== 'text') return 'normal'
  const s = el.fontStyle as TextFontStyleKonva | 'italic bold' | undefined
  if (s === 'italic bold' || s === 'bold italic') return 'bold italic'
  if (s === 'bold') return 'bold'
  if (s === 'italic') return 'italic'
  if (s === 'normal') return 'normal'
  return 'normal'
}

export function resolveTextAlign(
  el: Pick<CanvasElement, 'kind' | 'textAlign'>,
): TextAlignKonva {
  if (el.kind !== 'text') return 'left'
  const a = el.textAlign
  if (a === 'center' || a === 'right') return a
  return 'left'
}

/** Max encoded size per dropped image file (client-side canvas + encrypted IDB). */
export const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024

export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export interface CanvasState {
  elements: CanvasElement[]
  connectors: Connector[]
  viewport: {
    x: number
    y: number
    scale: number
  }
}

export type Anchor = 'top' | 'right' | 'bottom' | 'left'

export interface Connector {
  id: string
  fromId: string
  toId: string
  fromAnchor: Anchor
  toAnchor: Anchor
  label?: string
  color: string
  style: 'solid' | 'dashed'
}

export const DEFAULT_STATE: CanvasState = {
  elements: [],
  connectors: [],
  viewport: { x: 0, y: 0, scale: 1 },
}

/**
 * Mural-style palette: pastel fills with a bit more body + darker paired inks
 * for accessible contrast on stickies, cards, tasks, text, and pencil strokes.
 */
export const MURAL_CANVAS_SWATCHES = [
  { fill: '#F5E6B8', ink: '#4A3D05' },
  { fill: '#C9E8CA', ink: '#134E1A' },
  { fill: '#F0C8D8', ink: '#7A0C35' },
  { fill: '#CDDCF5', ink: '#122C72' },
  { fill: '#DFCEF2', ink: '#3B1674' },
  { fill: '#FFDCC4', ink: '#8B3410' },
  { fill: '#C0E8ED', ink: '#0A5259' },
  { fill: '#D9DEE5', ink: '#0F172A' },
] as const

/** @deprecated Use `MURAL_CANVAS_SWATCHES`. */
export const FIGJAM_CANVAS_SWATCHES = MURAL_CANVAS_SWATCHES

/** Sticky note fills. */
export const NOTE_COLORS = MURAL_CANVAS_SWATCHES.map((s) => s.fill)

/** Card fills: white first, then the same tints as notes. */
export const CARD_COLORS = [
  '#FFFFFF',
  ...MURAL_CANVAS_SWATCHES.map((s) => s.fill),
] as const

/** Task left accent = ink colors. */
export const TASK_ACCENT_COLORS = MURAL_CANVAS_SWATCHES.map((s) => s.ink)

/** Text / pencil strokes = same inks as task accents. */
export const TEXT_COLORS = MURAL_CANVAS_SWATCHES.map((s) => s.ink)

/**
 * Mural-style palette: greys + white, then strong hues.
 * Used for free text, geometric shapes, pencil strokes, and their side swatches.
 */
export const MURAL_TEXT_PALETTE = [
  '#0A0A0A',
  '#262626',
  '#404040',
  '#525252',
  '#737373',
  '#A3A3A3',
  '#D4D4D4',
  '#F5F5F5',
  '#FFFFFF',
  '#B91C1C',
  '#C2410C',
  '#CA8A04',
  '#4D7C0F',
  '#15803D',
  '#0F766E',
  '#0369A1',
  '#1D4ED8',
  '#4338CA',
  '#6D28D9',
  '#A21CAF',
  '#BE185D',
] as const

export const ELEMENT_DEFAULTS: Record<
  ElementKind,
  { width: number; height: number; text: string; color: string }
> = {
  note: {
    width: 200,
    height: 200,
    text: 'Note',
    color: NOTE_COLORS[0],
  },
  card: {
    width: 180,
    height: 80,
    text: 'Card',
    color: MURAL_TEXT_PALETTE[8],
  },
  ellipse: {
    width: 140,
    height: 100,
    text: '',
    color: MURAL_TEXT_PALETTE[15],
  },
  triangle: {
    width: 140,
    height: 120,
    text: '',
    color: MURAL_TEXT_PALETTE[12],
  },
  diamond: {
    width: 120,
    height: 120,
    text: '',
    color: MURAL_TEXT_PALETTE[18],
  },
  task: {
    width: 220,
    height: 44,
    text: '• Task',
    color: TEXT_COLORS[3],
  },
  text: {
    width: 240,
    height: 40,
    text: '',
    color: MURAL_TEXT_PALETTE[1],
  },
  image: {
    width: 320,
    height: 240,
    text: '',
    color: '#e5e7eb',
  },
  pencil: {
    width: 140,
    height: 120,
    text: '',
    color: MURAL_TEXT_PALETTE[1],
  },
  folder: {
    width: 120,
    height: 104,
    text: 'Untitled folder',
    color: '#E8EEF9',
  },
  comment: {
    width: 200,
    height: 88,
    text: 'Comment',
    color: '#F5F3FF',
  },
}

function isElementKind(v: unknown): v is ElementKind {
  return (
    v === 'note' ||
    v === 'task' ||
    v === 'card' ||
    v === 'ellipse' ||
    v === 'triangle' ||
    v === 'diamond' ||
    v === 'text' ||
    v === 'image' ||
    v === 'pencil' ||
    v === 'folder' ||
    v === 'comment'
  )
}

function isCanvasElement(v: unknown): v is CanvasElement {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    !isElementKind(o.kind) ||
    typeof o.x !== 'number' ||
    typeof o.y !== 'number' ||
    typeof o.width !== 'number' ||
    typeof o.height !== 'number' ||
    typeof o.text !== 'string' ||
    typeof o.color !== 'string'
  ) {
    return false
  }
  if (o.kind === 'pencil') {
    if (!Array.isArray(o.points)) return false
    if (o.points.length < 4) return false
    if (!o.points.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return false
    }
    if (
      typeof o.strokeWidth !== 'number' ||
      !Number.isFinite(o.strokeWidth) ||
      o.strokeWidth <= 0
    ) {
      return false
    }
  }
  if (o.kind === 'image') {
    return typeof o.imageSrc === 'string' && isValidImageSrc(o.imageSrc)
  }
  if (o.kind === 'folder') {
    if (o.imageSrc !== undefined) return false
  }
  if (o.imageSrc !== undefined && typeof o.imageSrc !== 'string') return false
  if (o.parentFolderId !== undefined && typeof o.parentFolderId !== 'string') {
    return false
  }
  if (o.fontSize !== undefined) {
    if (typeof o.fontSize !== 'number' || !Number.isFinite(o.fontSize)) {
      return false
    }
  }
  if (o.fontFamily !== undefined && typeof o.fontFamily !== 'string') {
    return false
  }
  if (o.fontStyle !== undefined) {
    if (typeof o.fontStyle !== 'string') return false
    const norm =
      o.fontStyle === 'italic bold' ? 'bold italic' : o.fontStyle
    if (
      norm !== 'normal' &&
      norm !== 'italic' &&
      norm !== 'bold' &&
      norm !== 'bold italic'
    ) {
      return false
    }
  }
  if (
    o.textAlign !== undefined &&
    o.textAlign !== 'left' &&
    o.textAlign !== 'center' &&
    o.textAlign !== 'right'
  ) {
    return false
  }
  return true
}

export function isCanvasState(v: unknown): v is CanvasState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (
    !Array.isArray(o.elements) ||
    !Array.isArray(o.connectors) ||
    !o.viewport ||
    typeof o.viewport !== 'object'
  ) {
    return false
  }
  const vp = o.viewport as Record<string, unknown>
  if (
    typeof vp.x !== 'number' ||
    typeof vp.y !== 'number' ||
    typeof vp.scale !== 'number'
  ) {
    return false
  }
  return o.elements.every(isCanvasElement) && o.connectors.every(isConnector)
}

function isAnchor(v: unknown): v is Anchor {
  return v === 'top' || v === 'right' || v === 'bottom' || v === 'left'
}

function isConnector(v: unknown): v is Connector {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.fromId !== 'string' ||
    typeof o.toId !== 'string' ||
    !isAnchor(o.fromAnchor) ||
    !isAnchor(o.toAnchor) ||
    typeof o.color !== 'string' ||
    (o.style !== 'solid' && o.style !== 'dashed')
  ) {
    return false
  }
  if (o.label !== undefined && typeof o.label !== 'string') return false
  return true
}

function normalizeViewport(v: unknown): CanvasState['viewport'] | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (
    typeof o.x !== 'number' ||
    typeof o.y !== 'number' ||
    typeof o.scale !== 'number' ||
    !Number.isFinite(o.x) ||
    !Number.isFinite(o.y) ||
    !Number.isFinite(o.scale)
  ) {
    return null
  }
  return { x: o.x, y: o.y, scale: o.scale }
}

function normalizeConnector(v: unknown): Connector | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.fromId !== 'string' ||
    typeof o.toId !== 'string' ||
    typeof o.color !== 'string' ||
    (o.style !== 'solid' && o.style !== 'dashed')
  ) {
    return null
  }
  if (!isAnchor(o.fromAnchor) || !isAnchor(o.toAnchor)) return null
  if (o.label !== undefined && typeof o.label !== 'string') return null
  const c: Connector = {
    id: o.id,
    fromId: o.fromId,
    toId: o.toId,
    fromAnchor: o.fromAnchor,
    toAnchor: o.toAnchor,
    color: o.color,
    style: o.style,
  }
  if (o.label !== undefined) c.label = o.label
  return c
}

function normalizeFontStyle(v: unknown): TextFontStyleKonva | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') return undefined
  const norm = v === 'italic bold' ? 'bold italic' : v
  if (
    norm === 'normal' ||
    norm === 'italic' ||
    norm === 'bold' ||
    norm === 'bold italic'
  ) {
    return norm
  }
  return undefined
}

function normalizeElement(v: unknown): CanvasElement | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (
    typeof o.id !== 'string' ||
    typeof o.x !== 'number' ||
    typeof o.y !== 'number' ||
    typeof o.width !== 'number' ||
    typeof o.height !== 'number' ||
    typeof o.text !== 'string' ||
    typeof o.color !== 'string' ||
    !isElementKind(o.kind) ||
    !Number.isFinite(o.x) ||
    !Number.isFinite(o.y) ||
    !Number.isFinite(o.width) ||
    !Number.isFinite(o.height)
  ) {
    return null
  }

  const base: CanvasElement = {
    id: o.id,
    kind: o.kind,
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    text: o.text,
    color: o.color,
  }

  if (o.kind === 'pencil') {
    if (!Array.isArray(o.points)) return null
    if (o.points.length < 4) return null
    if (!o.points.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return null
    }
    if (
      typeof o.strokeWidth !== 'number' ||
      !Number.isFinite(o.strokeWidth) ||
      o.strokeWidth <= 0
    ) {
      return null
    }
    base.points = o.points.slice() as number[]
    base.strokeWidth = o.strokeWidth
    return base
  }

  if (o.kind === 'image') {
    if (typeof o.imageSrc !== 'string' || !isValidImageSrc(o.imageSrc)) {
      return null
    }
    base.imageSrc = o.imageSrc
    return base
  }

  if (o.kind === 'folder') {
    if (o.imageSrc !== undefined) return null
  } else if (o.imageSrc !== undefined) {
    if (typeof o.imageSrc !== 'string' || !isValidImageSrc(o.imageSrc)) {
      return null
    }
    base.imageSrc = o.imageSrc
  }

  if (o.parentFolderId !== undefined) {
    if (typeof o.parentFolderId !== 'string') return null
    base.parentFolderId = o.parentFolderId
  }
  if (o.fontSize !== undefined) {
    if (typeof o.fontSize !== 'number' || !Number.isFinite(o.fontSize)) {
      return null
    }
    base.fontSize = o.fontSize
  }
  if (o.fontFamily !== undefined) {
    if (
      typeof o.fontFamily === 'string' &&
      ALLOWED_FONT_FAMILIES.has(o.fontFamily)
    ) {
      base.fontFamily = o.fontFamily
    }
  }
  const fs = normalizeFontStyle(o.fontStyle)
  if (fs !== undefined) base.fontStyle = fs
  if (
    o.textAlign === 'left' ||
    o.textAlign === 'center' ||
    o.textAlign === 'right'
  ) {
    base.textAlign = o.textAlign
  }
  return base
}

function normalizeCanvasState(parsed: unknown): CanvasState | null {
  if (!parsed || typeof parsed !== 'object') return null
  const o = parsed as Record<string, unknown>
  if (!Array.isArray(o.elements) || !Array.isArray(o.connectors)) return null
  const viewport = normalizeViewport(o.viewport)
  if (!viewport) return null
  const elements: CanvasElement[] = []
  for (const raw of o.elements) {
    const el = normalizeElement(raw)
    if (el) elements.push(el)
  }
  const connectors: Connector[] = []
  for (const raw of o.connectors) {
    const c = normalizeConnector(raw)
    if (c) connectors.push(c)
  }
  return { elements, connectors, viewport }
}

export type CanvasStateParseCorruption = 'invalid_json' | 'invalid_schema'

export type ParseCanvasStateResult = {
  state: CanvasState
  corruption: CanvasStateParseCorruption | null
}

export const CANVAS_STATE_PARSE_WARNING_EVENT = 'folium:canvas-state-parse-warning'

export function parseCanvasStateJson(json: string): ParseCanvasStateResult {
  try {
    const parsed: unknown = JSON.parse(json)
    const state = normalizeCanvasState(parsed)
    if (state) {
      return { state, corruption: null }
    }
    if (import.meta.env.DEV) {
      console.warn('[Folium] canvas state: invalid schema after parse')
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(CANVAS_STATE_PARSE_WARNING_EVENT, {
          detail: { reason: 'invalid_schema' as const },
        }),
      )
    }
    return { state: DEFAULT_STATE, corruption: 'invalid_schema' }
  } catch {
    if (import.meta.env.DEV) {
      console.warn('[Folium] canvas state: invalid JSON')
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(CANVAS_STATE_PARSE_WARNING_EVENT, {
          detail: { reason: 'invalid_json' as const },
        }),
      )
    }
    return { state: DEFAULT_STATE, corruption: 'invalid_json' }
  }
}
