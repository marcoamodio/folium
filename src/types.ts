export type ElementKind = 'note' | 'task' | 'card' | 'text' | 'image'

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
  viewport: {
    x: number
    y: number
    scale: number
  }
}

export const DEFAULT_STATE: CanvasState = {
  elements: [],
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
  return o.imageSrc === undefined || typeof o.imageSrc === 'string'
}

export function isCanvasState(v: unknown): v is CanvasState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.elements) || !o.viewport || typeof o.viewport !== 'object') {
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
  return o.elements.every(isCanvasElement)
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
