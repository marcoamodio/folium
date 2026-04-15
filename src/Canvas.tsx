import Konva from 'konva'
import {
  ListChecks,
  MousePointer2,
  Square,
  StickyNote,
  Type,
} from 'lucide-react'
import type { CSSProperties, ChangeEvent, DragEvent as ReactDragEvent } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import {
  Arrow,
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
} from 'react-konva'
import { subscribeCanvasPersistence } from './canvasPersistence'
import type {
  Anchor,
  CanvasElement,
  CanvasState,
  ElementKind,
  TextAlignKonva,
  TextFontStyleKonva,
} from './types'
import {
  ALLOWED_IMAGE_MIME_TYPES,
  CARD_COLORS,
  defaultTextFontFamily,
  ELEMENT_DEFAULTS,
  MAX_IMAGE_UPLOAD_BYTES,
  NOTE_COLORS,
  resolveTextAlign,
  resolveTextFontFamily,
  resolveTextFontSize,
  resolveTextFontStyle,
  TASK_ACCENT_COLORS,
  TEXT_COLORS,
  TEXT_FONT_PRESETS,
  TEXT_FONT_SIZE_DEFAULT,
  TEXT_FONT_SIZES,
  TEXT_SIZE_OPTIONS,
} from './types'
import { useCanvasHistory } from './useCanvasHistory'

const SCALE_MIN = 0.1
const SCALE_MAX = 4
const ZOOM_STEP = 1.08
const WORLD_DOT_STEP = 24
const NOTE_HEADER = 32
const MIN_ELEMENT_W = 80
const MIN_ELEMENT_H = 40
const MARQUEE_THRESHOLD = 5
const HANDLE_SIZE = 8
const CONNECTOR_SNAP_DIST = 16

/** FigJam-style free text */
const TEXT_LINE_HEIGHT = 1.357
const TEXT_PAD_X = 6
const TEXT_PAD_Y = 4
const FIGJAM_TEXT_STROKE = '#783ae9'
const FIGJAM_PLACEHOLDER = '#a3a3a3'

const UI_SANS =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

const TEXT_SIZE_CHOICES = new Set<number>(TEXT_FONT_SIZES)

type WorldPos = { x: number; y: number }

function anchorWorldPos(
  el: Pick<CanvasElement, 'x' | 'y' | 'width' | 'height'>,
  anchor: Anchor,
): WorldPos {
  switch (anchor) {
    case 'top':
      return { x: el.x + el.width / 2, y: el.y }
    case 'right':
      return { x: el.x + el.width, y: el.y + el.height / 2 }
    case 'bottom':
      return { x: el.x + el.width / 2, y: el.y + el.height }
    case 'left':
      return { x: el.x, y: el.y + el.height / 2 }
    default:
      return { x: el.x, y: el.y }
  }
}

function anchorDir(anchor: Anchor): WorldPos {
  switch (anchor) {
    case 'top':
      return { x: 0, y: -1 }
    case 'right':
      return { x: 1, y: 0 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    default:
      return { x: 0, y: 0 }
  }
}

function bezierPoints(from: WorldPos, fromAnchor: Anchor, to: WorldPos, toAnchor: Anchor) {
  const offset = 80
  const d1 = anchorDir(fromAnchor)
  const d2 = anchorDir(toAnchor)
  const cp1 = { x: from.x + d1.x * offset, y: from.y + d1.y * offset }
  const cp2 = { x: to.x + d2.x * offset, y: to.y + d2.y * offset }
  return { cp1, cp2, points: [from.x, from.y, cp1.x, cp1.y, cp2.x, cp2.y, to.x, to.y] }
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const mt = 1 - t
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * p1 +
    3 * mt * t * t * p2 +
    t * t * t * p3
  )
}

function bezierMidpoint(from: WorldPos, cp1: WorldPos, cp2: WorldPos, to: WorldPos): WorldPos {
  const t = 0.5
  return {
    x: cubicAt(from.x, cp1.x, cp2.x, to.x, t),
    y: cubicAt(from.y, cp1.y, cp2.y, to.y, t),
  }
}

function coerceToolbarFontSize(px: number): number {
  const c = Math.min(96, Math.max(8, Math.round(px)))
  if (TEXT_SIZE_CHOICES.has(c)) return c
  let best: number = TEXT_FONT_SIZES[0]
  let bestD = Math.abs(best - c)
  for (const s of TEXT_FONT_SIZES) {
    const d = Math.abs(s - c)
    if (d < bestD) {
      best = s
      bestD = d
    }
  }
  return best
}

function normalizeEditFontFamily(family: string): string {
  return (
    TEXT_FONT_PRESETS.find((p) => p.family === family)?.family ??
    defaultTextFontFamily()
  )
}

function toggleTextBold(style: TextFontStyleKonva): TextFontStyleKonva {
  if (style === 'bold') return 'normal'
  if (style === 'bold italic') return 'italic'
  if (style === 'italic') return 'bold italic'
  return 'bold'
}

function toggleTextItalic(style: TextFontStyleKonva): TextFontStyleKonva {
  if (style === 'italic') return 'normal'
  if (style === 'bold italic') return 'bold'
  if (style === 'bold') return 'bold italic'
  return 'italic'
}

/** Longest edge in world px when placing a dropped image (keeps board + IDB payload reasonable). */
const IMAGE_MAX_WORLD_EDGE = 720

const ALLOWED_IMAGE_MIME_SET = new Set<string>(ALLOWED_IMAGE_MIME_TYPES)

function imageExtensionOk(name: string): boolean {
  return /\.(jpe?g|png|gif|webp)$/i.test(name)
}

/** Accept for drop: allowed MIME, size cap, or unknown MIME with safe extension (some OS omit type). */
function isAcceptedBoardImageFile(file: File): boolean {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) return false
  if (ALLOWED_IMAGE_MIME_SET.has(file.type)) return true
  if (!file.type && imageExtensionOk(file.name)) return true
  return false
}

function looksLikeImageAttempt(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return imageExtensionOk(file.name)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

function naturalSizeFromDataUrl(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () =>
      resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('image-decode'))
    img.src = dataUrl
  })
}

function worldSizeForImage(nw: number, nh: number): { width: number; height: number } {
  const maxEdge = Math.max(nw, nh, 1)
  const scale = Math.min(1, IMAGE_MAX_WORLD_EDGE / maxEdge)
  const width = Math.max(MIN_ELEMENT_W, Math.round(nw * scale))
  const height = Math.max(MIN_ELEMENT_H, Math.round(nh * scale))
  return { width, height }
}

function createImageElement(
  cx: number,
  cy: number,
  imageSrc: string,
  nw: number,
  nh: number,
  indexOffset: number,
): CanvasElement {
  const { width, height } = worldSizeForImage(nw, nh)
  const d = ELEMENT_DEFAULTS.image
  const stagger = indexOffset * 24
  return {
    id: crypto.randomUUID(),
    kind: 'image',
    x: cx - width / 2 + stagger,
    y: cy - height / 2 + stagger,
    width,
    height,
    text: d.text,
    color: d.color,
    imageSrc,
  }
}

function BoardRasterImage({
  src,
  width,
  height,
}: {
  src: string
  width: number
  height: number
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    const image = new window.Image()
    let cancelled = false
    image.onload = () => {
      if (!cancelled) setImg(image)
    }
    image.onerror = () => {
      if (!cancelled) setImg(null)
    }
    image.src = src
    return () => {
      cancelled = true
    }
  }, [src])
  if (!img) {
    return (
      <Rect
        width={width}
        height={height}
        fill="#f3f4f6"
        cornerRadius={6}
        listening={false}
      />
    )
  }
  return (
    <KonvaImage
      image={img}
      width={width}
      height={height}
      cornerRadius={6}
      listening={false}
    />
  )
}

function measureTextBlockHeight(
  text: string,
  boxWidth: number,
  fontSize: number = TEXT_FONT_SIZE_DEFAULT,
  fontFamily: string = defaultTextFontFamily(),
  fontStyle: TextFontStyleKonva = 'normal',
): number {
  const innerW = Math.max(16, boxWidth - TEXT_PAD_X * 2)
  const node = new Konva.Text({
    text: text.trim() ? text : '\u00a0',
    width: innerW,
    fontSize,
    fontFamily,
    fontStyle,
    lineHeight: TEXT_LINE_HEIGHT,
    wrap: 'word',
  })
  const innerH = node.height()
  node.destroy()
  return Math.max(MIN_ELEMENT_H, Math.ceil(innerH + TEXT_PAD_Y * 2))
}

type ActiveTool = 'select' | 'note' | 'task' | 'card' | 'text' | 'connect'
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function createElement(kind: ElementKind, cx: number, cy: number): CanvasElement {
  if (kind === 'image') {
    throw new Error('createElement: images are added via drag-and-drop')
  }
  const d = ELEMENT_DEFAULTS[kind]
  if (kind === 'text') {
    const fs = TEXT_FONT_SIZE_DEFAULT
    const ff = defaultTextFontFamily()
    const fst: TextFontStyleKonva = 'normal'
    const ta: TextAlignKonva = 'left'
    return {
      id: crypto.randomUUID(),
      kind: 'text',
      x: cx,
      y: cy,
      width: d.width,
      height: measureTextBlockHeight(d.text, d.width, fs, ff, fst),
      text: d.text,
      color: d.color,
      fontSize: fs,
      fontFamily: ff,
      fontStyle: fst,
      textAlign: ta,
    }
  }
  return {
    id: crypto.randomUUID(),
    kind,
    x: cx - d.width / 2,
    y: cy - d.height / 2,
    width: d.width,
    height: d.height,
    text: d.text,
    color: d.color,
  }
}

function worldFromPointer(
  stage: Konva.Stage,
  viewport: CanvasState['viewport'],
): { wx: number; wy: number } | null {
  const p = stage.getPointerPosition()
  if (!p) return null
  return {
    wx: (p.x - viewport.x) / viewport.scale,
    wy: (p.y - viewport.y) / viewport.scale,
  }
}

function screenRectFromStage(
  stage: Konva.Stage,
  el: CanvasElement,
  viewport: CanvasState['viewport'],
): { left: number; top: number; width: number; height: number } {
  const cont = stage.container().getBoundingClientRect()
  const s = viewport.scale
  const { x: px, y: py } = viewport
  return {
    left: cont.left + el.x * s + px,
    top: cont.top + el.y * s + py,
    width: el.width * s,
    height: el.height * s,
  }
}

function screenPointFromStage(
  stage: Konva.Stage,
  world: WorldPos,
  viewport: CanvasState['viewport'],
): { left: number; top: number } {
  const cont = stage.container().getBoundingClientRect()
  const s = viewport.scale
  const { x: px, y: py } = viewport
  return {
    left: cont.left + world.x * s + px,
    top: cont.top + world.y * s + py,
  }
}

function rectsIntersect(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

function normalizeMarquee(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; width: number; height: number } {
  const nx = w < 0 ? x + w : x
  const ny = h < 0 ? y + h : y
  return { x: nx, y: ny, width: Math.abs(w), height: Math.abs(h) }
}

function applyResize(
  orig: CanvasElement,
  handle: HandleId,
  wx: number,
  wy: number,
): { x: number; y: number; width: number; height: number } {
  const { x: ox, y: oy, width: ow, height: oh } = orig
  const right = ox + ow
  const bottom = oy + oh
  let nx = ox
  let ny = oy
  let nw = ow
  let nh = oh

  switch (handle) {
    case 'nw': {
      nx = Math.min(wx, right - MIN_ELEMENT_W)
      ny = Math.min(wy, bottom - MIN_ELEMENT_H)
      nw = right - nx
      nh = bottom - ny
      break
    }
    case 'n': {
      ny = Math.min(wy, bottom - MIN_ELEMENT_H)
      nh = bottom - ny
      break
    }
    case 'ne': {
      ny = Math.min(wy, bottom - MIN_ELEMENT_H)
      nw = Math.max(MIN_ELEMENT_W, wx - ox)
      nh = bottom - ny
      break
    }
    case 'e': {
      nw = Math.max(MIN_ELEMENT_W, wx - ox)
      break
    }
    case 'se': {
      nw = Math.max(MIN_ELEMENT_W, wx - ox)
      nh = Math.max(MIN_ELEMENT_H, wy - oy)
      break
    }
    case 's': {
      nh = Math.max(MIN_ELEMENT_H, wy - oy)
      break
    }
    case 'sw': {
      nx = Math.min(wx, right - MIN_ELEMENT_W)
      nw = right - nx
      nh = Math.max(MIN_ELEMENT_H, wy - oy)
      break
    }
    case 'w': {
      nx = Math.min(wx, right - MIN_ELEMENT_W)
      nw = right - nx
      break
    }
    default:
      break
  }

  return { x: nx, y: ny, width: nw, height: nh }
}

function cursorForHandle(h: HandleId): string {
  const map: Record<HandleId, string> = {
    nw: 'nw-resize',
    n: 'n-resize',
    ne: 'ne-resize',
    e: 'e-resize',
    se: 'se-resize',
    s: 's-resize',
    sw: 'sw-resize',
    w: 'w-resize',
  }
  return map[h]
}

function modPositive(n: number, m: number): number {
  return ((n % m) + m) % m
}

function targetIsBoardBackground(
  target: Konva.Node,
  stage: Konva.Stage,
): boolean {
  if (target.name() === 'folium-bg') return true
  return target === stage
}

function isSpaceReservedForTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (target.isContentEditable) return true
  return false
}

type CanvasElementNodeProps = {
  el: CanvasElement
  display: CanvasElement
  selected: boolean
  editing: boolean
  /** FigJam-style: Space = hand tool; elements ignore pointer so pan works on top of them. */
  handMode: boolean
  onSelect: (id: string) => void
  onDragStart: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  onEditRequest: (el: CanvasElement) => void
}

function CanvasElementNode({
  el,
  display,
  selected,
  editing,
  handMode,
  onSelect,
  onDragStart,
  onDragEnd,
  onEditRequest,
}: CanvasElementNodeProps) {
  const canInteract = !handMode
  const stopBubbleForItemDrag = (
    e: Konva.KonvaEventObject<MouseEvent>,
  ) => {
    const b = e.evt.button
    if (b === 1) return
    if (b !== 0) return
    if (handMode) return
    e.cancelBubble = true
  }
  if (display.kind === 'note') {
    return (
      <Group
        x={display.x}
        y={display.y}
        listening={canInteract}
        draggable={canInteract}
        onMouseDown={stopBubbleForItemDrag}
        onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return
          e.cancelBubble = true
          onSelect(el.id)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragEnd(el.id, e.target.x(), e.target.y())
        }}
        onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true
          onEditRequest(el)
        }}
      >
        <Rect
          width={display.width}
          height={NOTE_HEADER}
          fill="#fde047"
          cornerRadius={[8, 8, 0, 0]}
        />
        <Rect
          y={NOTE_HEADER}
          width={display.width}
          height={display.height - NOTE_HEADER}
          fill={display.color}
          cornerRadius={[0, 0, 8, 8]}
          shadowColor="#00000022"
          shadowBlur={8}
          shadowOffsetY={4}
          shadowEnabled
        />
        {!editing ? (
          <Text
            x={12}
            y={NOTE_HEADER + 12}
            width={display.width - 24}
            height={display.height - NOTE_HEADER - 24}
            text={display.text}
            fontSize={13}
            fill="#374151"
            wrap="word"
            verticalAlign="top"
            listening={false}
          />
        ) : null}
        {selected ? (
          <Rect
            width={display.width}
            height={display.height}
            cornerRadius={8}
            stroke="#3b82f6"
            strokeWidth={2}
            listening={false}
          />
        ) : null}
      </Group>
    )
  }

  if (display.kind === 'card') {
    return (
      <Group
        x={display.x}
        y={display.y}
        listening={canInteract}
        draggable={canInteract}
        onMouseDown={stopBubbleForItemDrag}
        onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return
          e.cancelBubble = true
          onSelect(el.id)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragEnd(el.id, e.target.x(), e.target.y())
        }}
        onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true
          onEditRequest(el)
        }}
      >
        <Rect
          width={display.width}
          height={display.height}
          fill={display.color}
          cornerRadius={8}
          stroke={selected ? '#3b82f6' : '#e5e7eb'}
          strokeWidth={selected ? 2 : 1.5}
          shadowColor="#00000015"
          shadowBlur={6}
          shadowOffsetY={2}
          shadowEnabled
        />
        {!editing ? (
          <Text
            x={12}
            y={0}
            width={display.width - 24}
            height={display.height}
            text={display.text}
            fontSize={13}
            fill="#111827"
            wrap="word"
            verticalAlign="middle"
            align="center"
            listening={false}
          />
        ) : null}
      </Group>
    )
  }

  if (display.kind === 'text') {
    const empty = display.text.trim().length === 0
    const textFontSize = resolveTextFontSize(display)
    const textFontFamily = resolveTextFontFamily(display)
    const textFontStyle = resolveTextFontStyle(display)
    const textAlign = resolveTextAlign(display)
    return (
      <Group
        x={display.x}
        y={display.y}
        listening={canInteract}
        draggable={canInteract}
        onMouseDown={stopBubbleForItemDrag}
        onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return
          e.cancelBubble = true
          onSelect(el.id)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragEnd(el.id, e.target.x(), e.target.y())
        }}
        onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true
          onEditRequest(el)
        }}
      >
        <Rect
          width={display.width}
          height={display.height}
          fill="rgba(0,0,0,0.002)"
        />
        {!editing ? (
          <Text
            x={TEXT_PAD_X}
            y={TEXT_PAD_Y}
            width={display.width - TEXT_PAD_X * 2}
            height={display.height - TEXT_PAD_Y * 2}
            text={empty ? 'Add text' : display.text}
            fontSize={textFontSize}
            fontFamily={textFontFamily}
            fontStyle={textFontStyle}
            lineHeight={TEXT_LINE_HEIGHT}
            fill={empty ? FIGJAM_PLACEHOLDER : display.color}
            wrap="word"
            verticalAlign="top"
            align={textAlign}
            listening={false}
          />
        ) : null}
        {selected && !editing ? (
          <Rect
            width={display.width}
            height={display.height}
            stroke={FIGJAM_TEXT_STROKE}
            strokeWidth={1.25}
            dash={[5, 4]}
            listening={false}
          />
        ) : null}
      </Group>
    )
  }

  if (display.kind === 'image') {
    const src = display.imageSrc ?? ''
    return (
      <Group
        x={display.x}
        y={display.y}
        listening={canInteract}
        draggable={canInteract}
        onMouseDown={stopBubbleForItemDrag}
        onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return
          e.cancelBubble = true
          onSelect(el.id)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragEnd(el.id, e.target.x(), e.target.y())
        }}
      >
        {/* Konva needs a listening child for hit tests; Image is non-listening for perf. */}
        <Rect
          width={display.width}
          height={display.height}
          cornerRadius={6}
          fill="rgba(0,0,0,0.01)"
        />
        {src ? (
          <BoardRasterImage
            src={src}
            width={display.width}
            height={display.height}
          />
        ) : (
          <Rect
            width={display.width}
            height={display.height}
            fill="#e5e7eb"
            cornerRadius={6}
            listening={false}
          />
        )}
        <Rect
          width={display.width}
          height={display.height}
          cornerRadius={6}
          fill="rgba(0,0,0,0)"
          stroke={selected ? '#3b82f6' : '#e5e7eb'}
          strokeWidth={selected ? 2 : 1}
          listening={false}
        />
      </Group>
    )
  }

  return (
    <Group
      x={display.x}
      y={display.y}
      listening={canInteract}
      draggable={canInteract}
      onMouseDown={stopBubbleForItemDrag}
      onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.evt.button !== 0) return
        e.cancelBubble = true
        onSelect(el.id)
      }}
      onDragStart={() => onDragStart(el.id)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        onDragEnd(el.id, e.target.x(), e.target.y())
      }}
      onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true
        onEditRequest(el)
      }}
    >
      <Rect
        width={display.width}
        height={display.height}
        fill="#ffffff"
        cornerRadius={6}
        stroke={selected ? '#3b82f6' : '#e5e7eb'}
        strokeWidth={selected ? 2 : 1}
      />
      <Rect
        width={4}
        height={display.height}
        fill={display.color}
        cornerRadius={[6, 0, 0, 6]}
        listening={false}
      />
      {!editing ? (
        <Text
          x={20}
          y={0}
          width={display.width - 28}
          height={display.height}
          text={display.text}
          fontSize={13}
          fill="#111827"
          wrap="word"
          verticalAlign="middle"
          align="left"
          listening={false}
        />
      ) : null}
    </Group>
  )
}

const HANDLE_POSITIONS: HandleId[] = [
  'nw',
  'n',
  'ne',
  'e',
  'se',
  's',
  'sw',
  'w',
]

function ResizeHandlesLayer({
  el,
  viewport,
  handMode,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onHoverHandle,
}: {
  el: CanvasElement
  viewport: CanvasState['viewport']
  handMode: boolean
  onResizeStart: (handle: HandleId) => void
  onResizeMove: (handle: HandleId, wx: number, wy: number) => void
  onResizeEnd: () => void
  onHoverHandle: (handle: HandleId | null) => void
}) {
  const handlesActive = !handMode
  const { x, y, width: w, height: h } = el
  const half = HANDLE_SIZE / 2
  const cx = (hx: number, hy: number) => ({ hx: hx - half, hy: hy - half })

  const pos: Record<HandleId, { hx: number; hy: number }> = {
    nw: cx(x, y),
    n: cx(x + w / 2, y),
    ne: cx(x + w, y),
    e: cx(x + w, y + h / 2),
    se: cx(x + w, y + h),
    s: cx(x + w / 2, y + h),
    sw: cx(x, y + h),
    w: cx(x, y + h / 2),
  }

  return (
    <>
      {HANDLE_POSITIONS.map((hid) => {
        const p = pos[hid]
        return (
          <Rect
            key={hid}
            x={p.hx}
            y={p.hy}
            width={HANDLE_SIZE}
            height={HANDLE_SIZE}
            fill="#ffffff"
            stroke="#3b82f6"
            strokeWidth={1.5}
            cornerRadius={2}
            listening={handlesActive}
            draggable={handlesActive}
            onMouseEnter={() => onHoverHandle(hid)}
            onMouseLeave={() => onHoverHandle(null)}
            onDragStart={() => onResizeStart(hid)}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const stage = e.target.getStage()
              if (!stage) return
              const pt = worldFromPointer(stage, viewport)
              if (!pt) return
              onResizeMove(hid, pt.wx, pt.wy)
            }}
            onDragEnd={() => onResizeEnd()}
          />
        )
      })}
    </>
  )
}

/** Left tool rail: larger hit targets (~FigJam / 44px+ touch). */
const SIDENAV_BTN_PX = 48
const SIDENAV_ICON_PX = 24

const leftToolbarStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '12px 10px',
  background: '#ffffff',
  backgroundColor: '#ffffff',
  backgroundImage: 'none',
  borderRadius: 14,
  border: '1px solid #e5e7eb',
  boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
  overflow: 'hidden',
}

const toolBtnBase: CSSProperties = {
  width: SIDENAV_BTN_PX,
  height: SIDENAV_BTN_PX,
  minWidth: SIDENAV_BTN_PX,
  minHeight: SIDENAV_BTN_PX,
  borderRadius: 10,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  color: '#374151',
  flexShrink: 0,
  touchAction: 'manipulation',
}

const zoomBarStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  left: 'auto',
  bottom: 20,
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: '4px 6px',
  background: '#ffffff',
  backgroundColor: '#ffffff',
  backgroundImage: 'none',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
  overflow: 'hidden',
}

const zoomBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  color: '#374151',
}

const zoomPercentStyle: CSSProperties = {
  minWidth: 44,
  textAlign: 'center',
  fontSize: 12,
  fontWeight: 500,
  color: '#374151',
  fontFamily: UI_SANS,
  userSelect: 'none',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const swatchPanelStyle: CSSProperties = {
  position: 'fixed',
  /* 16 (dock left) + 10 pad + btn + 10 pad + gap */
  left: 16 + 10 + SIDENAV_BTN_PX + 10 + 8,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  background: '#ffffff',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
}

const swatchBtn: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.12)',
  cursor: 'pointer',
  padding: 0,
}

function IconFigjamBold() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M3.5 2.5h5.2c2.4 0 3.8 1.2 3.8 3 0 1.2-.7 2.1-1.8 2.5 1.4.4 2.3 1.4 2.3 3 0 2.1-1.5 3.5-4 3.5H3.5v-12zm2 5.2h2.6c1 0 1.6-.5 1.6-1.3 0-.8-.5-1.2-1.5-1.2H5.5v2.5zm0 4.8h2.9c1.1 0 1.8-.5 1.8-1.5 0-.9-.6-1.5-1.9-1.5H5.5V12.5z" />
    </svg>
  )
}

function IconFigjamItalic() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 2.5h6M7 13.5h6M9.5 2.5L6.5 13.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconFigjamAa() {
  return (
    <svg width="18" height="14" viewBox="0 0 20 14" fill="currentColor" aria-hidden>
      <path d="M1 11.5L4.2 2.5h1.6L9 11.5H7.4L6.5 9H3.5L2.6 11.5H1zm3.1-5.2h1.8L5.5 5.2 4.1 6.3h1zm8.4-3.8h1.8l4.2 9h-1.6l-1-2.5H13l-1 2.5h-1.6l4.2-9zm-.2 5.5h2.8L15.5 5.5l-1.2 3.5z" />
    </svg>
  )
}

function IconFigjamAlignLeft() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden>
      <path
        d="M2 2h12M2 6h8M2 10h10M2 14h6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconFigjamAlignCenter() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden>
      <path
        d="M2 2h12M4 6h8M3 10h10M5 14h6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

function IconFigjamAlignRight() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden>
      <path
        d="M2 2h12M6 6h8M4 10h10M8 14h6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  )
}

const figjamTextToolbarSelect: CSSProperties = {
  fontSize: 12,
  padding: '5px 22px 5px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.14)',
  background: '#404040',
  color: '#fafafa',
  cursor: 'pointer',
  maxHeight: 30,
}

function IconZoomOut() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        d="M5 10h10"
      />
    </svg>
  )
}

function IconZoomIn() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        d="M10 5v10M5 10h10"
      />
    </svg>
  )
}

function IconConnect() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M6 10h8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="5.5" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="14.5" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export function Canvas({ initialState }: { initialState: CanvasState }) {
  const { state, commit, undo, redo } = useCanvasHistory(initialState)
  const stateRef = useRef(state)

  const stageRef = useRef<Konva.Stage>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    null,
  )
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [connectorDraft, setConnectorDraft] = useState<{
    fromId: string
    fromAnchor: Anchor
    toWorldPos: WorldPos
    snappedTo: { toId: string; toAnchor: Anchor } | null
  } | null>(null)
  const connectorDraftRef = useRef<typeof connectorDraft>(null)
  const [marquee, setMarquee] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const marqueeSession = useRef<{
    startWx: number
    startWy: number
    startClientX: number
    startClientY: number
  } | null>(null)

  const [resizePreview, setResizePreview] = useState<CanvasElement | null>(
    null,
  )
  const resizeSession = useRef<{
    orig: CanvasElement
    handle: HandleId
  } | null>(null)

  const [draggingElementId, setDraggingElementId] = useState<string | null>(
    null,
  )
  const [hoverHandle, setHoverHandle] = useState<HandleId | null>(null)
  const [hoverElement, setHoverElement] = useState(false)
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null)
  const [hoveredAnchorKey, setHoveredAnchorKey] = useState<string | null>(null)

  const effectiveSelectedIds = useMemo(() => {
    const set = new Set(state.elements.map((e) => e.id))
    return selectedIds.filter((id) => set.has(id))
  }, [selectedIds, state.elements])

  const effectiveSelectedIdsRef = useRef<string[]>([])
  useLayoutEffect(() => {
    effectiveSelectedIdsRef.current = effectiveSelectedIds
  }, [effectiveSelectedIds])

  const panning = useRef(false)
  const panOrigin = useRef({ cx: 0, cy: 0, vx: 0, vy: 0 })
  const viewportUiRef = useRef({ x: 0, y: 0, scale: 1 })
  const resizePreviewRef = useRef<CanvasElement | null>(null)
  const spaceDown = useRef(false)
  const [handMode, setHandMode] = useState(false)

  const listenersRef = useRef(new Set<() => void>())
  const emit = useCallback(() => {
    listenersRef.current.forEach((fn) => fn())
  }, [])

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  useLayoutEffect(() => {
    connectorDraftRef.current = connectorDraft
  }, [connectorDraft])

  useLayoutEffect(() => {
    return subscribeCanvasPersistence({
      serialize: () => JSON.stringify(stateRef.current),
      subscribe: (cb) => {
        listenersRef.current.add(cb)
        return () => listenersRef.current.delete(cb)
      },
    })
  }, [])

  useEffect(() => {
    emit()
  }, [state, emit])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const sync = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const container = stage.container()
    if (!container) return
    container.style.backgroundColor = 'transparent'
    container.style.backgroundImage = 'none'
    const canvases = container.querySelectorAll('canvas')
    canvases.forEach((c) => {
      c.style.backgroundColor = 'transparent'
    })
  }, [size.w, size.h])

  const [panDraft, setPanDraft] = useState<{ x: number; y: number } | null>(
    null,
  )
  const vx = panDraft?.x ?? state.viewport.x
  const vy = panDraft?.y ?? state.viewport.y
  const vScale = state.viewport.scale

  const viewportMemo = useMemo(
    () => ({ x: vx, y: vy, scale: vScale }),
    [vx, vy, vScale],
  )

  useLayoutEffect(() => {
    viewportUiRef.current = { x: vx, y: vy, scale: vScale }
  }, [vx, vy, vScale])

  useLayoutEffect(() => {
    resizePreviewRef.current = resizePreview
  }, [resizePreview])

  const endPan = useCallback(() => {
    if (!panning.current) return
    panning.current = false
    setPanDraft((d) => {
      if (d) {
        commit((draft) => {
          draft.viewport.x = d.x
          draft.viewport.y = d.y
        })
      }
      return null
    })
  }, [commit])

  useEffect(() => {
    const up = () => endPan()
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
    return () => {
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
    }
  }, [endPan])

  const marqueeListenersRef = useRef<{
    onMove: (e: MouseEvent) => void
    onUp: (e: MouseEvent) => void
  }>({ onMove: () => {}, onUp: () => {} })

  const stableMarqueeMove = useCallback((e: MouseEvent) => {
    marqueeListenersRef.current.onMove(e)
  }, [])

  const stableMarqueeUp = useCallback((e: MouseEvent) => {
    marqueeListenersRef.current.onUp(e)
  }, [])

  useLayoutEffect(() => {
    marqueeListenersRef.current.onMove = (e: MouseEvent) => {
      const s = marqueeSession.current
      if (!s) return
      const stage = stageRef.current
      if (!stage) return
      const { x: vxx, y: vyy, scale } = viewportUiRef.current
      const rect = stage.container().getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const curWx = (px - vxx) / scale
      const curWy = (py - vyy) / scale
      setMarquee({
        x: s.startWx,
        y: s.startWy,
        width: curWx - s.startWx,
        height: curWy - s.startWy,
      })
    }

    marqueeListenersRef.current.onUp = (e: MouseEvent) => {
      const s = marqueeSession.current
      if (!s) return

      const dx = e.clientX - s.startClientX
      const dy = e.clientY - s.startClientY
      const dist = Math.hypot(dx, dy)

      const stage = stageRef.current
      const { x: vxx, y: vyy, scale } = viewportUiRef.current
      let norm = { x: 0, y: 0, width: 0, height: 0 }
      if (stage) {
        const rect = stage.container().getBoundingClientRect()
        const px = e.clientX - rect.left
        const py = e.clientY - rect.top
        const endWx = (px - vxx) / scale
        const endWy = (py - vyy) / scale
        norm = normalizeMarquee(
          s.startWx,
          s.startWy,
          endWx - s.startWx,
          endWy - s.startWy,
        )
      }

      marqueeSession.current = null
      setMarquee(null)
      window.removeEventListener('mousemove', stableMarqueeMove)
      window.removeEventListener('mouseup', stableMarqueeUp)

      if (dist < MARQUEE_THRESHOLD) {
        setSelectedIds([])
        return
      }

      const rp = resizePreviewRef.current
      const hit = stateRef.current.elements
        .filter((el) => {
          const d = rp?.id === el.id ? rp : el
          return rectsIntersect(
            norm.x,
            norm.y,
            norm.width,
            norm.height,
            d.x,
            d.y,
            d.width,
            d.height,
          )
        })
        .map((el) => el.id)
      setSelectedIds(hit)
    }
  }, [stableMarqueeMove, stableMarqueeUp])

  const startMarquee = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>, startWx: number, startWy: number) => {
      marqueeSession.current = {
        startWx,
        startWy,
        startClientX: e.evt.clientX,
        startClientY: e.evt.clientY,
      }
      window.addEventListener('mousemove', stableMarqueeMove)
      window.addEventListener('mouseup', stableMarqueeUp)
    },
    [stableMarqueeMove, stableMarqueeUp],
  )

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', stableMarqueeMove)
      window.removeEventListener('mouseup', stableMarqueeUp)
    }
  }, [stableMarqueeMove, stableMarqueeUp])

  const clearMarqueeSession = useCallback(() => {
    window.removeEventListener('mousemove', stableMarqueeMove)
    window.removeEventListener('mouseup', stableMarqueeUp)
    marqueeSession.current = null
    setMarquee(null)
  }, [stableMarqueeMove, stableMarqueeUp])

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const onBg = targetIsBoardBackground(e.target, stage)
    const panInput =
      e.evt.button === 1 ||
      (e.evt.button === 0 && spaceDown.current)
    const canPan = panInput && !editing
    if (canPan) {
      e.evt.preventDefault()
      panning.current = true
      panOrigin.current = {
        cx: e.evt.clientX,
        cy: e.evt.clientY,
        vx: state.viewport.x,
        vy: state.viewport.y,
      }
      setPanDraft({ x: state.viewport.x, y: state.viewport.y })
      return
    }

    if (
      onBg &&
      e.evt.button === 0 &&
      activeTool === 'select' &&
      !spaceDown.current
    ) {
      const w = worldFromPointer(stage, viewportMemo)
      if (w) startMarquee(e, w.wx, w.wy)
    }
  }

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!panning.current) return
    const { cx, cy, vx: ox, vy: oy } = panOrigin.current
    setPanDraft({
      x: ox + e.evt.clientX - cx,
      y: oy + e.evt.clientY - cy,
    })
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (isSpaceReservedForTyping(e.target)) return
        e.preventDefault()
        spaceDown.current = true
        setHoverHandle(null)
        flushSync(() => setHandMode(true))
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (e.key === 'Escape') {
        if (connectorDraftRef.current) {
          setConnectorDraft(null)
          return
        }
        if (activeTool === 'connect') {
          setActiveTool('select')
        } else {
          setActiveTool('select')
        }
        setSelectedConnectorId(null)
        clearMarqueeSession()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false
        flushSync(() => setHandMode(false))
      }
    }
    const onWinBlur = () => {
      spaceDown.current = false
      flushSync(() => setHandMode(false))
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', onWinBlur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', onWinBlur)
    }
  }, [activeTool, undo, redo, clearMarqueeSession])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement?.tagName
      if (active === 'INPUT' || active === 'TEXTAREA') return
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      e.preventDefault()

      const selectedConn = selectedConnectorId
      if (selectedConn) {
        setSelectedConnectorId(null)
        commit((d) => {
          d.connectors = d.connectors.filter((c) => c.id !== selectedConn)
        })
        return
      }

      const ids = effectiveSelectedIdsRef.current
      if (ids.length === 0) return
      const remove = new Set(ids)
      setSelectedIds([])
      commit((d) => {
        d.elements = d.elements.filter((x) => !remove.has(x.id))
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit, selectedConnectorId])

  const zoomFromCenter = useCallback(
    (factor: number) => {
      const oldScale = vScale
      const newScale = clamp(oldScale * factor, SCALE_MIN, SCALE_MAX)
      if (newScale === oldScale) return
      panning.current = false
      setPanDraft(null)
      const pointer = { x: size.w / 2, y: size.h / 2 }
      const mousePointTo = {
        x: (pointer.x - vx) / oldScale,
        y: (pointer.y - vy) / oldScale,
      }
      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      }
      commit((d) => {
        d.viewport.scale = newScale
        d.viewport.x = newPos.x
        d.viewport.y = newPos.y
      })
    },
    [vx, vy, vScale, size.w, size.h, commit],
  )

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return

    const ev = e.evt
    const zoomChord = ev.metaKey || ev.ctrlKey

    if (zoomChord) {
      const oldScale = vScale
      const newScale = clamp(
        ev.deltaY < 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP,
        SCALE_MIN,
        SCALE_MAX,
      )
      if (newScale === oldScale) return
      const pointer = stage.getPointerPosition()
      if (!pointer) return
      const mousePointTo = {
        x: (pointer.x - vx) / oldScale,
        y: (pointer.y - vy) / oldScale,
      }
      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      }
      panning.current = false
      setPanDraft(null)
      commit((d) => {
        d.viewport.scale = newScale
        d.viewport.x = newPos.x
        d.viewport.y = newPos.y
      })
      return
    }

    let dx = ev.deltaX
    let dy = ev.deltaY
    if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      dx *= 16
      dy *= 16
    } else if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      dx *= size.w * 0.85
      dy *= size.h * 0.85
    }
    if (dx === 0 && dy === 0) return

    panning.current = false
    setPanDraft(null)
    commit((d) => {
      d.viewport.x = vx - dx
      d.viewport.y = vy - dy
    })
  }

  const onBgClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage || !targetIsBoardBackground(e.target, stage)) return
    if (e.evt.button !== 0) return
    if (spaceDown.current) return
    setSelectedConnectorId(null)
    if (activeTool !== 'select' && activeTool !== 'connect') {
      const w = worldFromPointer(stage, viewportMemo)
      if (!w) return
      const tool = activeTool
      const next = createElement(tool, w.wx, w.wy)
      commit((d) => {
        d.elements.push(next)
      })
      setActiveTool('select')
      setSelectedIds([next.id])
      if (tool === 'text') {
        setEditing(next)
        setEditText('')
      }
    }
  }

  const onDragEnd = (id: string, x: number, y: number) => {
    setDraggingElementId(null)
    commit((d) => {
      const found = d.elements.find((x) => x.id === id)
      if (found) {
        found.x = x
        found.y = y
      }
    })
  }

  const [editing, setEditing] = useState<CanvasElement | null>(null)
  const [editText, setEditText] = useState('')
  const [editFontSize, setEditFontSize] = useState(TEXT_FONT_SIZE_DEFAULT)
  const [editFontFamily, setEditFontFamily] = useState(() =>
    defaultTextFontFamily(),
  )
  const [editFontStyle, setEditFontStyle] =
    useState<TextFontStyleKonva>('normal')
  const [editTextAlign, setEditTextAlign] =
    useState<TextAlignKonva>('left')
  const [editTextColor, setEditTextColor] = useState<string>(TEXT_COLORS[0])
  const [editLayout, setEditLayout] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [editLayoutTick, setEditLayoutTick] = useState(0)
  const textEditRef = useRef<HTMLTextAreaElement | null>(null)
  const [textColorMenuOpen, setTextColorMenuOpen] = useState(false)
  const textColorMenuRef = useRef<HTMLDivElement>(null)
  /** Text formatting toolbar (font/size selects); blur deferral avoids closing before native `<select>` opens. */
  const textToolbarRef = useRef<HTMLDivElement>(null)

  const editingLive = useMemo(() => {
    if (!editing) return null
    return state.elements.find((e) => e.id === editing.id) ?? editing
  }, [editing, state.elements])

  useLayoutEffect(() => {
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      if (!editingLive) {
        setEditLayout(null)
        return
      }
      const stage = stageRef.current
      if (!stage) {
        setEditLayout(null)
        return
      }
      const base = screenRectFromStage(stage, editingLive, viewportMemo)
      if (editingLive.kind === 'text') {
        const ta = textEditRef.current
        const sh = ta?.scrollHeight
        const hPx =
          sh != null ? Math.max(base.height, sh) : Math.max(base.height, 24)
        setEditLayout({
          left: base.left,
          top: base.top,
          width: base.width,
          height: hPx,
        })
        return
      }
      setEditLayout(base)
    }
    const id = requestAnimationFrame(apply)
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [
    editingLive,
    viewportMemo,
    size.w,
    size.h,
    editText,
    editFontSize,
    editFontFamily,
    editFontStyle,
    editTextAlign,
    editTextColor,
    editLayoutTick,
  ])

  useEffect(() => {
    if (editing?.kind !== 'text') return
    const id = requestAnimationFrame(() => {
      const ta = textEditRef.current
      if (ta) {
        ta.style.height = '0'
        ta.style.height = `${ta.scrollHeight}px`
      }
      setEditLayoutTick((n) => n + 1)
    })
    return () => cancelAnimationFrame(id)
  }, [
    editing?.id,
    editing?.kind,
    editFontSize,
    editFontFamily,
    editFontStyle,
    editTextColor,
  ])

  useEffect(() => {
    if (!textColorMenuOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const root = textColorMenuRef.current
      if (root && !root.contains(e.target as Node)) {
        setTextColorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [textColorMenuOpen])

  const textareaPaddingStyle = useMemo((): CSSProperties => {
    if (!editing) return {}
    if (editing.kind === 'note') {
      return {
        padding: '12px',
        paddingTop: NOTE_HEADER + 12,
      }
    }
    if (editing.kind === 'card') {
      return { padding: '12px' }
    }
    if (editing.kind === 'text') {
      return {
        padding: `${TEXT_PAD_Y}px ${TEXT_PAD_X}px`,
      }
    }
    return { padding: '12px', paddingLeft: 20 }
  }, [editing])

  const onEditRequest = (el: CanvasElement) => {
    if (el.kind === 'image') return
    setTextColorMenuOpen(false)
    setEditing(el)
    setEditText(el.text)
    if (el.kind === 'text') {
      setEditFontSize(coerceToolbarFontSize(resolveTextFontSize(el)))
      setEditFontFamily(normalizeEditFontFamily(resolveTextFontFamily(el)))
      setEditFontStyle(resolveTextFontStyle(el))
      setEditTextAlign(resolveTextAlign(el))
      setEditTextColor(el.color)
    }
  }

  const closeEdit = () => {
    setTextColorMenuOpen(false)
    if (!editing) return
    const id = editing.id
    const text = editText
    const kind = editing.kind
    const fs = editFontSize
    const ff = editFontFamily
    const fst = editFontStyle
    const ta = editTextAlign
    const tc = editTextColor
    setEditing(null)
    commit((d) => {
      const found = d.elements.find((x) => x.id === id)
      if (found) {
        found.text = text
        if (kind === 'text') {
          found.fontSize = fs
          found.fontFamily = ff
          found.fontStyle = fst
          found.textAlign = ta
          found.color = tc
          found.height = measureTextBlockHeight(text, found.width, fs, ff, fst)
        }
      }
    })
  }

  const handleTextareaBlur = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ae = document.activeElement
        if (ae && textToolbarRef.current?.contains(ae)) return
        if (ae === textEditRef.current) return
        closeEdit()
      })
    })
  }

  const singleSelectedEl = useMemo(() => {
    if (effectiveSelectedIds.length !== 1) return null
    const id = effectiveSelectedIds[0]
    return state.elements.find((e) => e.id === id) ?? null
  }, [effectiveSelectedIds, state.elements])

  const displayElement = useCallback(
    (el: CanvasElement): CanvasElement => {
      if (resizePreview && resizePreview.id === el.id) return resizePreview
      return el
    },
    [resizePreview],
  )

  const elementById = useMemo(() => {
    const m = new Map<string, CanvasElement>()
    for (const el of state.elements) {
      m.set(el.id, displayElement(el))
    }
    return m
  }, [state.elements, displayElement])
  const elementByIdRef = useRef(elementById)
  useLayoutEffect(() => {
    elementByIdRef.current = elementById
  }, [elementById])

  const findSnapTarget = useCallback(
    (
      pos: WorldPos,
      fromId: string,
    ): { toId: string; toAnchor: Anchor; toWorldPos: WorldPos } | null => {
      let best: { toId: string; toAnchor: Anchor; toWorldPos: WorldPos; d: number } | null =
        null
      const anchors: Anchor[] = ['top', 'right', 'bottom', 'left']
      for (const [id, el] of elementByIdRef.current.entries()) {
        if (id === fromId) continue
        for (const a of anchors) {
          const ap = anchorWorldPos(el, a)
          const d = Math.hypot(ap.x - pos.x, ap.y - pos.y)
          if (d > CONNECTOR_SNAP_DIST) continue
          if (!best || d < best.d) {
            best = { toId: id, toAnchor: a, toWorldPos: ap, d }
          }
        }
      }
      if (!best) return null
      return { toId: best.toId, toAnchor: best.toAnchor, toWorldPos: best.toWorldPos }
    },
    [],
  )

  useEffect(() => {
    if (!connectorDraft) return
    const clientToWorld = (clientX: number, clientY: number) => {
      const stage = stageRef.current
      if (!stage) return null
      const { x: vxx, y: vyy, scale } = viewportUiRef.current
      const rect = stage.container().getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      return { wx: (px - vxx) / scale, wy: (py - vyy) / scale }
    }
    const onMove = (e: MouseEvent) => {
      const cur = connectorDraftRef.current
      if (!cur) return
      const p = clientToWorld(e.clientX, e.clientY)
      if (!p) return
      const snap = findSnapTarget({ x: p.wx, y: p.wy }, cur.fromId)
      setConnectorDraft({
        ...cur,
        toWorldPos: snap ? snap.toWorldPos : { x: p.wx, y: p.wy },
        snappedTo: snap ? { toId: snap.toId, toAnchor: snap.toAnchor } : null,
      })
    }
    const onUp = (e: MouseEvent) => {
      const cur = connectorDraftRef.current
      if (!cur) return
      const p = clientToWorld(e.clientX, e.clientY)
      const snap = p ? findSnapTarget({ x: p.wx, y: p.wy }, cur.fromId) : null
      if (snap) {
        const nextId = crypto.randomUUID()
        const fromId = cur.fromId
        const fromAnchor = cur.fromAnchor
        commit((d) => {
          d.connectors.push({
            id: nextId,
            fromId,
            toId: snap.toId,
            fromAnchor,
            toAnchor: snap.toAnchor,
            color: '#6b7280',
            style: 'solid',
          })
        })
        setSelectedConnectorId(nextId)
      }
      setConnectorDraft(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', () => setConnectorDraft(null), { once: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [commit, connectorDraft, findSnapTarget])

  const onResizeStart = (handle: HandleId) => {
    if (!singleSelectedEl) return
    resizeSession.current = { orig: { ...singleSelectedEl }, handle }
  }

  const onResizeMove = (handle: HandleId, wx: number, wy: number) => {
    const sess = resizeSession.current
    if (!sess) return
    const next = applyResize(sess.orig, handle, wx, wy)
    const full: CanvasElement = {
      ...sess.orig,
      ...next,
    }
    setResizePreview(full)
  }

  const onResizeEnd = () => {
    const sess = resizeSession.current
    resizeSession.current = null
    const prev = resizePreview
    setResizePreview(null)
    if (!sess || !prev) return
    commit((d) => {
      const f = d.elements.find((x) => x.id === prev.id)
      if (f) {
        f.x = prev.x
        f.y = prev.y
        f.width = prev.width
        f.height = prev.height
        if (f.kind === 'text') {
          f.height = measureTextBlockHeight(
            f.text,
            f.width,
            resolveTextFontSize(f),
            resolveTextFontFamily(f),
            resolveTextFontStyle(f),
          )
        }
      }
    })
  }

  const applyColorsToSelection = (color: string) => {
    const ids = new Set(effectiveSelectedIds)
    if (ids.size === 0) return
    commit((d) => {
      for (const el of d.elements) {
        if (ids.has(el.id)) el.color = color
      }
    })
  }

  const firstSelectedKind = useMemo(() => {
    if (effectiveSelectedIds.length === 0) return null
    const el = state.elements.find((e) => e.id === effectiveSelectedIds[0])
    return el?.kind ?? null
  }, [effectiveSelectedIds, state.elements])

  const palette =
    firstSelectedKind === 'note'
      ? NOTE_COLORS
      : firstSelectedKind === 'card'
        ? CARD_COLORS
        : firstSelectedKind === 'task'
          ? TASK_ACCENT_COLORS
          : firstSelectedKind === 'text'
            ? TEXT_COLORS
            : []

  const [boardDropMessage, setBoardDropMessage] = useState<string | null>(null)
  const boardDropMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  const showBoardDropMessage = useCallback((msg: string) => {
    if (boardDropMsgTimerRef.current) {
      clearTimeout(boardDropMsgTimerRef.current)
    }
    setBoardDropMessage(msg)
    boardDropMsgTimerRef.current = setTimeout(() => {
      setBoardDropMessage(null)
      boardDropMsgTimerRef.current = null
    }, 4800)
  }, [])

  useEffect(() => {
    return () => {
      if (boardDropMsgTimerRef.current) {
        clearTimeout(boardDropMsgTimerRef.current)
      }
    }
  }, [])

  const clientPointToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current
      if (!stage) return null
      const { x: vxx, y: vyy, scale } = viewportUiRef.current
      const rect = stage.container().getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      return { wx: (px - vxx) / scale, wy: (py - vyy) / scale }
    },
    [],
  )

  const handleBoardDragOver = useCallback((e: ReactDragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer?.types ?? [])
    if (!types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleBoardDrop = useCallback(
    async (e: ReactDragEvent<HTMLDivElement>) => {
      e.preventDefault()
      const stage = stageRef.current
      if (!stage) return
      const list = Array.from(e.dataTransfer.files)
      if (list.length === 0) return
      const pos = clientPointToWorld(e.clientX, e.clientY)
      if (!pos) return

      let skipped = 0
      const additions: CanvasElement[] = []
      let addIndex = 0
      for (const file of list) {
        if (!looksLikeImageAttempt(file)) continue
        if (!isAcceptedBoardImageFile(file)) {
          skipped++
          continue
        }
        try {
          const dataUrl = await readFileAsDataUrl(file)
          const { w, h } = await naturalSizeFromDataUrl(dataUrl)
          additions.push(
            createImageElement(pos.wx, pos.wy, dataUrl, w, h, addIndex),
          )
          addIndex++
        } catch {
          skipped++
        }
      }
      if (additions.length > 0) {
        commit((d) => {
          for (const el of additions) d.elements.push(el)
        })
        setSelectedIds(additions.map((x) => x.id))
        setActiveTool('select')
      }
      const triedImages = list.filter(looksLikeImageAttempt).length
      if (skipped > 0 && triedImages > 0) {
        const mb = Math.round(MAX_IMAGE_UPLOAD_BYTES / (1024 * 1024))
        showBoardDropMessage(
          additions.length === 0
            ? `Could not add image(s). Max ${mb} MB each; use JPEG, PNG, WebP, or GIF.`
            : `${skipped} file(s) skipped. Max ${mb} MB each; JPEG, PNG, WebP, or GIF only.`,
        )
      }
    },
    [clientPointToWorld, commit, showBoardDropMessage],
  )

  const updateCursor = useCallback(() => {
    const container = stageRef.current?.container()
    if (!container) return
    if (editing) {
      container.style.cursor = 'default'
      return
    }
    if (connectorDraft !== null) {
      container.style.cursor = 'crosshair'
      return
    }
    if (marquee !== null) {
      container.style.cursor = 'crosshair'
      return
    }
    if (activeTool !== 'select') {
      container.style.cursor = 'crosshair'
      return
    }
    if (handMode) {
      container.style.cursor = panning.current ? 'grabbing' : 'grab'
      return
    }
    if (hoverHandle) {
      container.style.cursor = cursorForHandle(hoverHandle)
      return
    }
    if (draggingElementId) {
      container.style.cursor = 'grabbing'
      return
    }
    if (hoverElement) {
      container.style.cursor = 'grab'
      return
    }
    container.style.cursor = 'default'
  }, [
    activeTool,
    connectorDraft,
    draggingElementId,
    editing,
    hoverElement,
    hoverHandle,
    handMode,
    marquee,
  ])

  useLayoutEffect(() => {
    updateCursor()
  }, [updateCursor])

  const onStageMouseMoveCursor = (e: Konva.KonvaEventObject<MouseEvent>) => {
    handleStageMouseMove(e)
    const stage = stageRef.current
    if (!stage) return
    const p = worldFromPointer(stage, viewportMemo)
    if (!p) {
      setHoverElement(false)
      setHoveredElementId(null)
      updateCursor()
      return
    }
    let overEl = false
    let overId: string | null = null
    for (const el of state.elements) {
      const d = displayElement(el)
      if (
        p.wx >= d.x &&
        p.wx <= d.x + d.width &&
        p.wy >= d.y &&
        p.wy <= d.y + d.height
      ) {
        overEl = true
        overId = el.id
        break
      }
    }
    setHoverElement(overEl)
    setHoveredElementId(overId)
    updateCursor()
  }

  const normMarquee = marquee ? normalizeMarquee(marquee.x, marquee.y, marquee.width, marquee.height) : null

  const dotStepPx = WORLD_DOT_STEP * vScale
  const boardSurfaceStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    touchAction: 'none',
    ['--folium-dot-step' as string]: `${dotStepPx}px`,
    ['--folium-bg-x' as string]: `${modPositive(vx, dotStepPx)}px`,
    ['--folium-bg-y' as string]: `${modPositive(vy, dotStepPx)}px`,
  }

  return (
    <div
      ref={wrapRef}
      className="folium-board-bg"
      style={boardSurfaceStyle}
      onDragOver={handleBoardDragOver}
      onDrop={handleBoardDrop}
    >
      <Stage
        ref={stageRef}
        className="folium-konva-root"
        width={size.w}
        height={size.h}
        x={vx}
        y={vy}
        scaleX={vScale}
        scaleY={vScale}
        style={{ background: 'transparent' }}
        onMouseDown={handleStageMouseDown}
        onMouseMove={onStageMouseMoveCursor}
        onWheel={onWheel}
      >
        <Layer>
          <Rect
            name="folium-bg"
            x={-1e6}
            y={-1e6}
            width={2e6}
            height={2e6}
            fill="#ffffff"
            opacity={0}
            listening
            onClick={onBgClick}
          />
          {state.connectors.map((c) => {
            const fromEl = elementById.get(c.fromId)
            const toEl = elementById.get(c.toId)
            if (!fromEl || !toEl) return null
            const from = anchorWorldPos(fromEl, c.fromAnchor)
            const to = anchorWorldPos(toEl, c.toAnchor)
            const { cp1, cp2, points } = bezierPoints(from, c.fromAnchor, to, c.toAnchor)
            const dash = c.style === 'dashed' ? [8, 4] : []
            const selected = selectedConnectorId === c.id
            const stroke = selected ? '#3b82f6' : c.color
            const strokeWidth = selected ? 3 : 2
            const mid = c.label ? bezierMidpoint(from, cp1, cp2, to) : null

            return (
              <Group key={c.id}>
                <Arrow
                  points={points}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  dash={dash}
                  lineCap="round"
                  lineJoin="round"
                  pointerLength={10}
                  pointerWidth={8}
                  pointerAtEnding
                  pointerAtBeginning={false}
                  bezier
                  hitStrokeWidth={12}
                  onClick={(e) => {
                    e.cancelBubble = true
                    setSelectedIds([])
                    setSelectedConnectorId(c.id)
                  }}
                />
                {mid && c.label ? (
                  <Group x={mid.x} y={mid.y} listening={false}>
                    <Rect
                      x={-((c.label.length * 6.2 + 8) / 2)}
                      y={-9}
                      width={c.label.length * 6.2 + 8}
                      height={18}
                      fill="#ffffff"
                      cornerRadius={4}
                      opacity={0.95}
                    />
                    <Text
                      x={-((c.label.length * 6.2) / 2)}
                      y={-7}
                      text={c.label}
                      fontSize={11}
                      fontFamily={UI_SANS}
                      fill="#374151"
                    />
                  </Group>
                ) : null}
              </Group>
            )
          })}
          {connectorDraft ? (() => {
            const fromEl = elementById.get(connectorDraft.fromId)
            if (!fromEl) return null
            const from = anchorWorldPos(fromEl, connectorDraft.fromAnchor)
            const to = connectorDraft.toWorldPos
            const toAnchor = connectorDraft.snappedTo?.toAnchor ?? 'left'
            const { points } = bezierPoints(from, connectorDraft.fromAnchor, to, toAnchor)
            return (
              <Arrow
                points={points}
                stroke="#3b82f6"
                strokeWidth={1.5}
                dash={[6, 6]}
                opacity={0.7}
                lineCap="round"
                lineJoin="round"
                pointerLength={10}
                pointerWidth={8}
                pointerAtEnding
                pointerAtBeginning={false}
                bezier
                listening={false}
              />
            )
          })() : null}
          {normMarquee ? (
            <Rect
              x={normMarquee.x}
              y={normMarquee.y}
              width={normMarquee.width}
              height={normMarquee.height}
              fill="rgba(59,130,246,0.08)"
              stroke="#3b82f6"
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />
          ) : null}
        </Layer>
        <Layer>
          {state.elements.map((el) => (
            <CanvasElementNode
              key={el.id}
              el={el}
              display={displayElement(el)}
              selected={effectiveSelectedIds.includes(el.id)}
              editing={editing?.id === el.id}
              handMode={handMode}
              onSelect={(id) => {
                setSelectedConnectorId(null)
                setSelectedIds([id])
              }}
              onDragStart={(id) => {
                setDraggingElementId(id)
                updateCursor()
              }}
              onDragEnd={onDragEnd}
              onEditRequest={onEditRequest}
            />
          ))}
        </Layer>
        {singleSelectedEl && !editing ? (
          <Layer>
            <ResizeHandlesLayer
              el={displayElement(singleSelectedEl)}
              viewport={viewportMemo}
              handMode={handMode}
              onResizeStart={onResizeStart}
              onResizeMove={onResizeMove}
              onResizeEnd={onResizeEnd}
              onHoverHandle={setHoverHandle}
            />
          </Layer>
        ) : null}
      </Stage>

      {(() => {
        const stage = stageRef.current
        if (!stage) return null
        const canShow =
          editing === null &&
          activeTool !== 'note' &&
          activeTool !== 'card' &&
          activeTool !== 'task' &&
          activeTool !== 'text' &&
          draggingElementId === null

        if (!canShow) return null

        const showingAll = activeTool === 'connect'
        const targetId = showingAll ? null : hoveredElementId
        if (!showingAll && !targetId) return null
        if (!showingAll && effectiveSelectedIds.includes(targetId)) return null

        const ids = showingAll
          ? state.elements.map((e) => e.id)
          : [targetId]

        const anchors: Anchor[] = ['top', 'right', 'bottom', 'left']
        const s = viewportMemo
        return ids.flatMap((id) => {
          const el = elementById.get(id)
          if (!el) return []
          return anchors.map((a) => {
            const key = `${id}:${a}`
            const wpos = anchorWorldPos(el, a)
            const p = screenPointFromStage(stage, wpos, s)
            const hovered = hoveredAnchorKey === key
            const snapped =
              connectorDraft?.snappedTo?.toId === id &&
              connectorDraft?.snappedTo?.toAnchor === a
            return (
              <div
                key={key}
                role="button"
                aria-label={`Anchor ${a}`}
                onMouseEnter={() => setHoveredAnchorKey(key)}
                onMouseLeave={() => setHoveredAnchorKey((cur) => (cur === key ? null : cur))}
                onMouseDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setSelectedIds([])
                  setSelectedConnectorId(null)
                  setConnectorDraft({
                    fromId: id,
                    fromAnchor: a,
                    toWorldPos: wpos,
                    snappedTo: null,
                  })
                }}
                style={{
                  position: 'fixed',
                  left: p.left - 6,
                  top: p.top - 6,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid #3b82f6',
                  background: hovered ? '#3b82f6' : '#ffffff',
                  boxSizing: 'border-box',
                  cursor: 'crosshair',
                  zIndex: 1200,
                  pointerEvents: 'auto',
                  boxShadow: snapped ? '0 0 0 3px rgba(59,130,246,0.25)' : undefined,
                }}
              />
            )
          })
        })
      })()}

      {editing?.kind === 'text' && editLayout ? (
        <div
          ref={textToolbarRef}
          role="toolbar"
          aria-label="Text formatting"
          style={{
            position: 'fixed',
            left: editLayout.left,
            top: Math.max(8, editLayout.top - 54),
            zIndex: 1250,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            padding: '5px 8px',
            background: '#262626',
            borderRadius: 10,
            boxShadow:
              '0 4px 20px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.06)',
            fontFamily: UI_SANS,
            pointerEvents: 'auto',
          }}
        >
          <div
            ref={textColorMenuRef}
            style={{ position: 'relative', flexShrink: 0 }}
          >
            <button
              type="button"
              aria-label="Text color"
              aria-haspopup="listbox"
              aria-expanded={textColorMenuOpen}
              title="Text color"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTextColorMenuOpen((o) => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 4px',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                background: textColorMenuOpen
                  ? 'rgba(255,255,255,0.12)'
                  : 'transparent',
                color: '#fafafa',
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: editTextColor,
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.25)',
                  flexShrink: 0,
                }}
              />
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden
                style={{
                  opacity: 0.85,
                  transform: textColorMenuOpen
                    ? 'rotate(180deg)'
                    : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              >
                <path
                  d="M2.5 4.25L6 7.75l3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {textColorMenuOpen ? (
              <div
                role="listbox"
                aria-label="Choose text color"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 1300,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  padding: 10,
                  width: 168,
                  boxSizing: 'border-box',
                  background: '#1a1a1a',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.12)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                }}
              >
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={editTextColor === c}
                    title={c}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setEditTextColor(c)
                      setEditLayoutTick((n) => n + 1)
                      setTextColorMenuOpen(false)
                    }}
                    style={{
                      width: 30,
                      height: 30,
                      padding: 0,
                      border:
                        editTextColor === c
                          ? '2px solid #fafafa'
                          : '2px solid transparent',
                      borderRadius: '50%',
                      background: c,
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <span
            aria-hidden
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.12)',
              margin: '0 8px',
              flexShrink: 0,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: '#fafafa',
            }}
          >
            <span style={{ display: 'flex', opacity: 0.9 }} aria-hidden>
              <IconFigjamAa />
            </span>
            <select
              aria-label="Font family"
              value={
                TEXT_FONT_PRESETS.find((p) => p.family === editFontFamily)
                  ?.id ?? TEXT_FONT_PRESETS[0].id
              }
              onChange={(e) => {
                const p = TEXT_FONT_PRESETS.find(
                  (x) => x.id === e.target.value,
                )
                if (p) {
                  setEditFontFamily(p.family)
                  setEditLayoutTick((n) => n + 1)
                }
              }}
              style={{ ...figjamTextToolbarSelect, minWidth: 118 }}
            >
              {TEXT_FONT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <span
            aria-hidden
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.12)',
              margin: '0 8px',
              flexShrink: 0,
            }}
          />
          <select
            aria-label="Text size"
            value={String(editFontSize)}
            onChange={(e) => {
              setEditFontSize(Number(e.target.value))
              setEditLayoutTick((n) => n + 1)
            }}
            style={{ ...figjamTextToolbarSelect, minWidth: 112 }}
          >
            {TEXT_SIZE_OPTIONS.map(({ px, label }) => (
              <option key={px} value={String(px)}>
                {label}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.12)',
              margin: '0 8px',
              flexShrink: 0,
            }}
          />
          <button
            type="button"
            title="Bold"
            aria-pressed={
              editFontStyle === 'bold' || editFontStyle === 'bold italic'
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditFontStyle((s) => toggleTextBold(s))
              setEditLayoutTick((n) => n + 1)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#fafafa',
              background:
                editFontStyle === 'bold' || editFontStyle === 'bold italic'
                  ? 'rgba(255,255,255,0.14)'
                  : 'transparent',
            }}
          >
            <IconFigjamBold />
          </button>
          <button
            type="button"
            title="Italic"
            aria-pressed={
              editFontStyle === 'italic' || editFontStyle === 'bold italic'
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditFontStyle((s) => toggleTextItalic(s))
              setEditLayoutTick((n) => n + 1)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#fafafa',
              background:
                editFontStyle === 'italic' || editFontStyle === 'bold italic'
                  ? 'rgba(255,255,255,0.14)'
                  : 'transparent',
            }}
          >
            <IconFigjamItalic />
          </button>
          <span
            aria-hidden
            style={{
              width: 1,
              height: 22,
              background: 'rgba(255,255,255,0.12)',
              margin: '0 8px',
              flexShrink: 0,
            }}
          />
          <button
            type="button"
            title="Align left"
            aria-pressed={editTextAlign === 'left'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditTextAlign('left')
              setEditLayoutTick((n) => n + 1)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#fafafa',
              background:
                editTextAlign === 'left'
                  ? 'rgba(255,255,255,0.14)'
                  : 'transparent',
            }}
          >
            <IconFigjamAlignLeft />
          </button>
          <button
            type="button"
            title="Align center"
            aria-pressed={editTextAlign === 'center'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditTextAlign('center')
              setEditLayoutTick((n) => n + 1)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#fafafa',
              background:
                editTextAlign === 'center'
                  ? 'rgba(255,255,255,0.14)'
                  : 'transparent',
            }}
          >
            <IconFigjamAlignCenter />
          </button>
          <button
            type="button"
            title="Align right"
            aria-pressed={editTextAlign === 'right'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setEditTextAlign('right')
              setEditLayoutTick((n) => n + 1)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              padding: 0,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: '#fafafa',
              background:
                editTextAlign === 'right'
                  ? 'rgba(255,255,255,0.14)'
                  : 'transparent',
            }}
          >
            <IconFigjamAlignRight />
          </button>
        </div>
      ) : null}

      {editLayout ? (
        <textarea
          ref={textEditRef}
          style={{
            position: 'fixed',
            left: editLayout.left,
            top: editLayout.top,
            width: editLayout.width,
            height: editLayout.height,
            zIndex: 1200,
            resize: 'none',
            fontSize:
              editing?.kind === 'text' ? editFontSize : 13,
            lineHeight: editing?.kind === 'text' ? TEXT_LINE_HEIGHT : 1.45,
            fontFamily:
              editing?.kind === 'text'
                ? editFontFamily
                : UI_SANS,
            fontWeight:
              editing?.kind === 'text' &&
              (editFontStyle === 'bold' || editFontStyle === 'bold italic')
                ? 'bold'
                : 'normal',
            fontStyle:
              editing?.kind === 'text' &&
              (editFontStyle === 'italic' || editFontStyle === 'bold italic')
                ? 'italic'
                : 'normal',
            textAlign:
              editing?.kind === 'text' ? editTextAlign : undefined,
            color: editing?.kind === 'text' ? editTextColor : '#111827',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            overflow: editing?.kind === 'text' ? 'hidden' : undefined,
            boxShadow:
              editing?.kind === 'text'
                ? '0 0 0 1px #3b82f6'
                : undefined,
            borderRadius: editing?.kind === 'text' ? 2 : undefined,
            ...textareaPaddingStyle,
          }}
          value={editText}
          placeholder={editing?.kind === 'text' ? 'Add text' : undefined}
          onChange={(ev: ChangeEvent<HTMLTextAreaElement>) => {
            setEditText(ev.target.value)
            if (editing?.kind === 'text') {
              const ta = ev.target
              ta.style.height = '0'
              ta.style.height = `${ta.scrollHeight}px`
              setEditLayoutTick((n) => n + 1)
            }
          }}
          onBlur={handleTextareaBlur}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') {
              ev.preventDefault()
              closeEdit()
            }
          }}
          autoFocus
        />
      ) : null}

      <div style={leftToolbarStyle}>
        <button
          type="button"
          title="Select"
          style={{
            ...toolBtnBase,
            background: activeTool === 'select' ? '#eff6ff' : 'transparent',
            color: activeTool === 'select' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'select')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'select' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('select')}
        >
          <MousePointer2
            size={SIDENAV_ICON_PX}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        <button
          type="button"
          title="Text"
          style={{
            ...toolBtnBase,
            background: activeTool === 'text' ? '#eff6ff' : 'transparent',
            color: activeTool === 'text' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'text')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'text' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('text')}
        >
          <Type size={SIDENAV_ICON_PX} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          title="Sticky note"
          style={{
            ...toolBtnBase,
            background: activeTool === 'note' ? '#eff6ff' : 'transparent',
            color: activeTool === 'note' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'note')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'note' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('note')}
        >
          <StickyNote size={SIDENAV_ICON_PX} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          title="Card"
          style={{
            ...toolBtnBase,
            background: activeTool === 'card' ? '#eff6ff' : 'transparent',
            color: activeTool === 'card' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'card')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'card' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('card')}
        >
          <Square size={SIDENAV_ICON_PX} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          title="Task"
          style={{
            ...toolBtnBase,
            background: activeTool === 'task' ? '#eff6ff' : 'transparent',
            color: activeTool === 'task' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'task')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'task' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('task')}
        >
          <ListChecks size={SIDENAV_ICON_PX} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          title="Connect"
          style={{
            ...toolBtnBase,
            background: activeTool === 'connect' ? '#eff6ff' : 'transparent',
            color: activeTool === 'connect' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'connect')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'connect' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('connect')}
        >
          <IconConnect />
        </button>
      </div>

      {palette.length > 0 && effectiveSelectedIds.length > 0 ? (
        <div style={swatchPanelStyle}>
          {palette.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              style={{ ...swatchBtn, background: c }}
              onClick={() => applyColorsToSelection(c)}
            />
          ))}
        </div>
      ) : null}

      <div style={zoomBarStyle}>
        <button
          type="button"
          title="Zoom out"
          style={zoomBtnStyle}
          onClick={() => zoomFromCenter(1 / ZOOM_STEP)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <IconZoomOut />
        </button>
        <span style={zoomPercentStyle}>{Math.round(vScale * 100)}%</span>
        <button
          type="button"
          title="Zoom in"
          style={zoomBtnStyle}
          onClick={() => zoomFromCenter(ZOOM_STEP)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <IconZoomIn />
        </button>
      </div>

      {boardDropMessage ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 2000,
            maxWidth: 440,
            padding: '10px 16px',
            background: '#1f2937',
            color: '#f9fafb',
            fontSize: 13,
            lineHeight: 1.4,
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
            pointerEvents: 'none',
            fontFamily: UI_SANS,
          }}
        >
          {boardDropMessage}
        </div>
      ) : null}
    </div>
  )
}
