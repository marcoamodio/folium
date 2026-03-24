export type ElementKind = 'note' | 'task' | 'card'

export interface CanvasElement {
  id: string
  kind: ElementKind
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
}

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

function isElementKind(v: unknown): v is ElementKind {
  return v === 'note' || v === 'task' || v === 'card'
}

function isCanvasElement(v: unknown): v is CanvasElement {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    isElementKind(o.kind) &&
    typeof o.x === 'number' &&
    typeof o.y === 'number' &&
    typeof o.width === 'number' &&
    typeof o.height === 'number' &&
    typeof o.text === 'string' &&
    typeof o.color === 'string'
  )
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
