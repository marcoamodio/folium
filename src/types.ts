export type ElementKind = 'note' | 'task' | 'card' | 'text' | 'image'

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

/** Default fill colors for sticky notes (cycle in UI). */
export const NOTE_COLORS = [
  '#fef08a',
  '#bbf7d0',
  '#fbcfe8',
  '#bfdbfe',
  '#e9d5ff',
] as const

/** Default fill colors for cards. */
export const CARD_COLORS = [
  '#ffffff',
  '#f0fdf4',
  '#fef9c3',
  '#fce7f3',
  '#eff6ff',
] as const

/** Left accent bar colors for tasks. */
export const TASK_ACCENT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
] as const

/** Text / paragraph tool: used as Konva Text fill. */
export const TEXT_COLORS = [
  '#111827',
  '#374151',
  '#1d4ed8',
  '#b45309',
  '#be123c',
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
    color: CARD_COLORS[0],
  },
  task: {
    width: 220,
    height: 44,
    text: '• Task',
    color: TASK_ACCENT_COLORS[0],
  },
  text: {
    width: 240,
    height: 40,
    text: '',
    color: TEXT_COLORS[0],
  },
  image: {
    width: 320,
    height: 240,
    text: '',
    color: '#e5e7eb',
  },
}

function isElementKind(v: unknown): v is ElementKind {
  return (
    v === 'note' ||
    v === 'task' ||
    v === 'card' ||
    v === 'text' ||
    v === 'image'
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
  if (o.kind === 'image') {
    return typeof o.imageSrc === 'string' && o.imageSrc.length > 0
  }
  if (o.imageSrc !== undefined && typeof o.imageSrc !== 'string') return false
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
