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
  if (typeof f === 'string' && f.trim().length > 0) return f
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
    return typeof o.imageSrc === 'string' && o.imageSrc.length > 0
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

export function parseCanvasStateJson(json: string): CanvasState {
  try {
    const parsed: unknown = JSON.parse(json)
    if (isCanvasState(parsed)) return parsed
  } catch {
    /* invalid JSON */
  }
  return DEFAULT_STATE
}
