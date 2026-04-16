import Konva from 'konva'
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ListChecks,
  MousePointer2,
  Pencil,
  Square,
  StickyNote,
  Type,
  X,
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
import { createPortal, flushSync } from 'react-dom'
import {
  Arrow,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from 'react-konva'
import { APP_DISPLAY_NAME, APP_VERSION } from './appMeta'
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
/** Screen-space dot grid step (px). Fixed like FigJam so zoom doesn’t change dot density. */
const SCREEN_DOT_GRID_STEP_PX = 24
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

type ActiveTool = 'select' | 'note' | 'task' | 'card' | 'text' | 'connect' | 'pencil'
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function createElement(kind: ElementKind, cx: number, cy: number): CanvasElement {
  if (kind === 'image') {
    throw new Error('createElement: images are added via drag-and-drop')
  }
  if (kind === 'folder') {
    throw new Error('createElement: folders are created by merging images')
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

const FOLDER_TITLE_PAD = 8
/** World-space rect for the folder label strip (matches Konva Text placement). */
function folderTitleWorldRect(el: CanvasElement): {
  x: number
  y: number
  w: number
  h: number
} {
  return {
    x: el.x + FOLDER_TITLE_PAD,
    y: el.y + el.height - 24,
    w: Math.max(24, el.width - FOLDER_TITLE_PAD * 2),
    h: 24,
  }
}

function folderTitleScreenRect(
  stage: Konva.Stage,
  el: CanvasElement,
  viewport: CanvasState['viewport'],
): { left: number; top: number; width: number; height: number } {
  const cont = stage.container().getBoundingClientRect()
  const s = viewport.scale
  const { x: px, y: py } = viewport
  const r = folderTitleWorldRect(el)
  return {
    left: cont.left + r.x * s + px,
    top: cont.top + r.y * s + py,
    width: r.w * s,
    height: Math.max(26, r.h * s),
  }
}

function screenPointFromRect(
  rect: DOMRect,
  world: WorldPos,
  viewport: CanvasState['viewport'],
): { left: number; top: number } {
  const s = viewport.scale
  const { x: px, y: py } = viewport
  return {
    left: rect.left + world.x * s + px,
    top: rect.top + world.y * s + py,
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

function rectIntersectionArea(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): number {
  const x0 = Math.max(ax, bx)
  const y0 = Math.max(ay, by)
  const x1 = Math.min(ax + aw, bx + bw)
  const y1 = Math.min(ay + ah, by + bh)
  if (x0 >= x1 || y0 >= y1) return 0
  return (x1 - x0) * (y1 - y0)
}

/** True when one image is dropped “onto” another (overlap / center-in-rect). */
function folderMergeHit(a: CanvasElement, b: CanvasElement): boolean {
  if (
    !rectsIntersect(
      a.x,
      a.y,
      a.width,
      a.height,
      b.x,
      b.y,
      b.width,
      b.height,
    )
  ) {
    return false
  }
  const ia = a.width * a.height
  const ib = b.width * b.height
  const inter = rectIntersectionArea(
    a.x,
    a.y,
    a.width,
    a.height,
    b.x,
    b.y,
    b.width,
    b.height,
  )
  const minA = Math.min(ia, ib)
  const ratio = minA > 0 ? inter / minA : 0
  const cx = a.x + a.width / 2
  const cy = a.y + a.height / 2
  const centerInB =
    cx >= b.x &&
    cx <= b.x + b.width &&
    cy >= b.y &&
    cy <= b.y + b.height
  return ratio >= 0.16 || centerInB
}

/** True when an image is dropped “onto” a folder (overlap / center-in-rect). */
function folderDropHit(image: CanvasElement, folder: CanvasElement): boolean {
  if (
    !rectsIntersect(
      image.x,
      image.y,
      image.width,
      image.height,
      folder.x,
      folder.y,
      folder.width,
      folder.height,
    )
  ) {
    return false
  }
  const ia = image.width * image.height
  const ib = folder.width * folder.height
  const inter = rectIntersectionArea(
    image.x,
    image.y,
    image.width,
    image.height,
    folder.x,
    folder.y,
    folder.width,
    folder.height,
  )
  const minA = Math.min(ia, ib)
  const ratio = minA > 0 ? inter / minA : 0
  const cx = image.x + image.width / 2
  const cy = image.y + image.height / 2
  const centerInFolder =
    cx >= folder.x &&
    cx <= folder.x + folder.width &&
    cy >= folder.y &&
    cy <= folder.y + folder.height
  return ratio >= 0.10 || centerInFolder
}

/** Include contained images when dragging a folder so they stay aligned in world space. */
function expandDragIdsWithFolderContents(
  ids: string[],
  elements: CanvasElement[],
): string[] {
  const out = new Set(ids)
  for (const el of elements) {
    if (el.kind !== 'folder' || !out.has(el.id)) continue
    for (const c of elements) {
      if (c.parentFolderId === el.id) out.add(c.id)
    }
  }
  return [...out]
}

const MAC_FOLDER_SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 72" fill="none">
<path fill="url(#foliumFGrad)" d="M10 26c0-5 4-9 9-9h17.5l5.5-7H62c5 0 9 4 9 9v34c0 5-4 9-9 9H19c-5 0-9-4-9-9V26Z"/>
<path fill="#fff" fill-opacity=".28" d="M10 26h68v1.5H10V26Z"/>
<defs><linearGradient id="foliumFGrad" x1="44" y1="10" x2="44" y2="62" gradientUnits="userSpaceOnUse">
<stop stop-color="#7EB6FF"/><stop offset="1" stop-color="#2F6EEB"/>
</linearGradient></defs>
</svg>`

let macFolderImgCache: HTMLImageElement | null = null
let macFolderImgLoading = false
const macFolderImgWait: Array<() => void> = []

function ensureMacFolderImage(onReady: (img: HTMLImageElement) => void) {
  if (macFolderImgCache) {
    onReady(macFolderImgCache)
    return
  }
  macFolderImgWait.push(() => {
    if (macFolderImgCache) onReady(macFolderImgCache)
  })
  if (macFolderImgLoading) return
  macFolderImgLoading = true
  const img = new window.Image()
  img.onload = () => {
    macFolderImgCache = img
    macFolderImgLoading = false
    macFolderImgWait.splice(0).forEach((fn) => fn())
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MAC_FOLDER_SVG_MARKUP)}`
}

function MacFolderGlyph({
  width,
  height,
}: {
  width: number
  height: number
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(macFolderImgCache)
  useEffect(() => {
    ensureMacFolderImage(setImg)
  }, [])
  if (!img) {
    return (
      <Rect
        width={width}
        height={height}
        fill="#4F8FFF"
        cornerRadius={10}
        listening={false}
      />
    )
  }
  return <KonvaImage image={img} width={width} height={height} listening={false} />
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
  folderMergeHintTargetId: string | null
  draggingElementId: string | null
  onSelect: (id: string, evt: MouseEvent) => void
  onDragStart: (id: string) => void
  onDragMove: (id: string, x: number, y: number) => void
  onDragEnd: (id: string, x: number, y: number) => void
  onEditRequest: (el: CanvasElement) => void
  onFolderOpen: (el: CanvasElement) => void
}

function CanvasElementNode({
  el,
  display,
  selected,
  editing,
  handMode,
  folderMergeHintTargetId,
  draggingElementId,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onEditRequest,
  onFolderOpen,
}: CanvasElementNodeProps) {
  const canInteract = !handMode
  const folderMergeHintActive =
    folderMergeHintTargetId != null && draggingElementId != null
  const dimForFolderMergeHint =
    folderMergeHintActive &&
    (el.id === draggingElementId || el.id === folderMergeHintTargetId)
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
          onSelect(el.id, e.evt)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragMove(el.id, e.target.x(), e.target.y())
        }}
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
          onSelect(el.id, e.evt)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragMove(el.id, e.target.x(), e.target.y())
        }}
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
          onSelect(el.id, e.evt)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragMove(el.id, e.target.x(), e.target.y())
        }}
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
        opacity={dimForFolderMergeHint ? 0.55 : 1}
        listening={canInteract}
        draggable={canInteract}
        onMouseDown={stopBubbleForItemDrag}
        onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
          if (e.evt.button !== 0) return
          e.cancelBubble = true
          onSelect(el.id, e.evt)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragMove(el.id, e.target.x(), e.target.y())
        }}
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

  if (display.kind === 'folder') {
    const pad = FOLDER_TITLE_PAD
    const iconW = Math.max(24, display.width - pad * 2)
    const iconH = Math.min(
      Math.max(40, display.height - 30),
      iconW * 0.75,
    )
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
          onSelect(el.id, e.evt)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragMove(el.id, e.target.x(), e.target.y())
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragEnd(el.id, e.target.x(), e.target.y())
        }}
      >
        <Rect
          width={display.width}
          height={display.height}
          cornerRadius={12}
          fill="rgba(255,255,255,0.97)"
          stroke={selected ? '#3b82f6' : '#e5e7eb'}
          strokeWidth={selected ? 2 : 1}
          shadowColor="#00000018"
          shadowBlur={8}
          shadowOffsetY={2}
          shadowEnabled
        />
        <Group x={(display.width - iconW) / 2} y={pad + 2}>
          <MacFolderGlyph width={iconW} height={iconH} />
          <Rect
            width={iconW}
            height={iconH}
            fill="rgba(0,0,0,0.001)"
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true
              onFolderOpen(el)
            }}
          />
        </Group>
        <Rect
          x={pad}
          y={display.height - 24}
          width={display.width - pad * 2}
          height={24}
          fill="rgba(0,0,0,0.004)"
          cornerRadius={4}
          stroke={editing ? 'rgba(59,130,246,0.85)' : 'transparent'}
          strokeWidth={1}
          listening={canInteract}
          cursor="text"
          onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true
          }}
          onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
            if (e.evt.button !== 0) return
            e.cancelBubble = true
            if (!selected) {
              onSelect(el.id, e.evt)
            }
            onEditRequest(el)
          }}
        />
        {!editing ? (
          <Text
            x={pad}
            y={display.height - 22}
            width={display.width - pad * 2}
            text={display.text}
            fontSize={11}
            fontFamily={UI_SANS}
            fill="#374151"
            ellipsis
            wrap="none"
            listening={false}
          />
        ) : null}
      </Group>
    )
  }

  if (display.kind === 'pencil') {
    const pts = display.points ?? []
    const sw = display.strokeWidth ?? 4
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
          onSelect(el.id, e.evt)
        }}
        onDragStart={() => onDragStart(el.id)}
        onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragMove(el.id, e.target.x(), e.target.y())
        }}
        onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
          onDragEnd(el.id, e.target.x(), e.target.y())
        }}
      >
        <Line
          points={pts}
          stroke={display.color}
          strokeWidth={sw}
          lineCap="round"
          lineJoin="round"
          tension={0}
          listening={false}
        />
        {selected ? (
          <Rect
            width={display.width}
            height={display.height}
            stroke="#3b82f6"
            strokeWidth={1.25}
            dash={[6, 5]}
            listening={false}
          />
        ) : null}
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
        onSelect(el.id, e.evt)
      }}
      onDragStart={() => onDragStart(el.id)}
      onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
        onDragMove(el.id, e.target.x(), e.target.y())
      }}
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

/** Bottom-right cluster: detached info CTA + zoom (FigJam-style gap). */
const canvasBottomRightClusterStyle: CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 20,
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  pointerEvents: 'none',
}

const infoCtaBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 6px',
  background: '#ffffff',
  borderRadius: 8,
  border: '1px solid #e5e7eb',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
  overflow: 'hidden',
}

const zoomBarStyle: CSSProperties = {
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
  const [wrapRect, setWrapRect] = useState<DOMRect | null>(null)

  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    null,
  )
  const [infoModalOpen, setInfoModalOpen] = useState(false)
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
  const dragSession = useRef<{
    draggedId: string
    ids: string[]
    origById: Map<string, { x: number; y: number }>
  } | null>(null)

  const [dragPreviewById, setDragPreviewById] = useState<
    Record<string, { x: number; y: number }> | null
  >(null)

  const [pencilColor, setPencilColor] = useState<string>(TEXT_COLORS[7])
  const [pencilSize, setPencilSize] = useState(4)
  const [pencilDraft, setPencilDraft] = useState<CanvasElement | null>(null)
  const pencilDraftRef = useRef<CanvasElement | null>(null)
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

  const [folderNaming, setFolderNaming] = useState<{
    draggedId: string
    targetId: string
  } | null>(null)
  const [folderNameDraft, setFolderNameDraft] = useState('Untitled folder')
  const folderNamingRef = useRef(false)
  useLayoutEffect(() => {
    folderNamingRef.current = folderNaming != null
  }, [folderNaming])
  const [folderMergeHintTargetId, setFolderMergeHintTargetId] = useState<
    string | null
  >(null)

  const [folderViewerId, setFolderViewerId] = useState<string | null>(null)
  const [folderViewerEntered, setFolderViewerEntered] = useState(false)
  const [folderViewerActiveImageId, setFolderViewerActiveImageId] = useState<
    string | null
  >(null)
  const folderViewerIdRef = useRef<string | null>(null)
  const folderViewerThumbsRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    folderViewerIdRef.current = folderViewerId
  }, [folderViewerId])

  const closeFolderViewer = useCallback(() => {
    setFolderViewerEntered(false)
    window.setTimeout(() => setFolderViewerId(null), 380)
  }, [])

  const openFolderViewer = useCallback((el: CanvasElement) => {
    if (el.kind !== 'folder') return
    setFolderViewerEntered(false)
    setFolderViewerId(el.id)
    setFolderViewerActiveImageId(null)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setFolderViewerEntered(true))
    })
  }, [])

  const tryQueueFolderMerge = useCallback(
    (draggedId: string, sess: { ids: string[] } | null) => {
      if (sess && sess.ids.length > 1) return
      const dragged = stateRef.current.elements.find((e) => e.id === draggedId)
      if (!dragged || dragged.kind !== 'image' || dragged.parentFolderId) return
      let bestOther: { id: string; area: number } | null = null
      for (const other of stateRef.current.elements) {
        if (other.id === draggedId) continue
        if (other.kind !== 'image' || other.parentFolderId) continue
        if (!folderMergeHit(dragged, other)) continue
        const area = rectIntersectionArea(
          dragged.x,
          dragged.y,
          dragged.width,
          dragged.height,
          other.x,
          other.y,
          other.width,
          other.height,
        )
        if (!bestOther || area > bestOther.area) {
          bestOther = { id: other.id, area }
        }
      }
      if (bestOther) {
        setFolderNameDraft(ELEMENT_DEFAULTS.folder.text)
        setFolderNaming({ draggedId, targetId: bestOther.id })
      }
    },
    [],
  )

  const confirmFolderNaming = useCallback(() => {
    const pending = folderNaming
    if (!pending) return
    const name = folderNameDraft.trim() || ELEMENT_DEFAULTS.folder.text
    const { draggedId, targetId } = pending
    const folderId = crypto.randomUUID()
    const def = ELEMENT_DEFAULTS.folder
    commit((d) => {
      const a = d.elements.find((z) => z.id === draggedId)
      const b = d.elements.find((z) => z.id === targetId)
      if (!a || !b || a.kind !== 'image' || b.kind !== 'image') return
      if (a.parentFolderId || b.parentFolderId) return
      d.connectors = d.connectors.filter(
        (c) =>
          c.fromId !== a.id &&
          c.toId !== a.id &&
          c.fromId !== b.id &&
          c.toId !== b.id,
      )
      const minX = Math.min(a.x, b.x)
      const minY = Math.min(a.y, b.y)
      const maxX = Math.max(a.x + a.width, b.x + b.width)
      const maxY = Math.max(a.y + a.height, b.y + b.height)
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      d.elements.push({
        id: folderId,
        kind: 'folder',
        x: cx - def.width / 2,
        y: cy - def.height / 2,
        width: def.width,
        height: def.height,
        text: name,
        color: def.color,
      })
      a.parentFolderId = folderId
      b.parentFolderId = folderId
    })
    setFolderNaming(null)
    setActiveTool('select')
    setSelectedIds([folderId])
  }, [folderNaming, folderNameDraft, commit])

  const rootElements = useMemo(
    () => state.elements.filter((e) => !e.parentFolderId),
    [state.elements],
  )

  const folderViewerFolder = useMemo(() => {
    if (!folderViewerId) return null
    return state.elements.find((e) => e.id === folderViewerId) ?? null
  }, [folderViewerId, state.elements])

  const folderViewerChildren = useMemo(() => {
    if (!folderViewerId) return []
    return state.elements.filter(
      (e) => e.parentFolderId === folderViewerId && e.kind === 'image',
    )
  }, [folderViewerId, state.elements])

  const folderViewerActiveIndex = useMemo(() => {
    if (folderViewerChildren.length === 0) return 0
    if (!folderViewerActiveImageId) return 0
    const idx = folderViewerChildren.findIndex(
      (x) => x.id === folderViewerActiveImageId,
    )
    return idx >= 0 ? idx : 0
  }, [folderViewerActiveImageId, folderViewerChildren])

  const folderViewerActiveImage =
    folderViewerChildren[folderViewerActiveIndex] ?? null

  const goFolderViewer = useCallback(
    (delta: -1 | 1) => {
      if (folderViewerChildren.length === 0) return
      const next = (folderViewerActiveIndex + delta + folderViewerChildren.length) %
        folderViewerChildren.length
      const nextId = folderViewerChildren[next]?.id
      if (!nextId) return
      setFolderViewerActiveImageId(nextId)
      requestAnimationFrame(() => {
        const root = folderViewerThumbsRef.current
        const btn = root?.querySelector<HTMLButtonElement>(
          `[data-thumb-id="${CSS.escape(nextId)}"]`,
        )
        btn?.scrollIntoView({ block: 'nearest', inline: 'center' })
      })
    },
    [folderViewerActiveIndex, folderViewerChildren],
  )

  useEffect(() => {
    if (!folderViewerId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isSpaceReservedForTyping(e.target)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goFolderViewer(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goFolderViewer(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [folderViewerId, goFolderViewer])

  const folderNameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!folderNaming) return
    const id = requestAnimationFrame(() => {
      folderNameInputRef.current?.focus()
      folderNameInputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [folderNaming])

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
    pencilDraftRef.current = pencilDraft
  }, [pencilDraft])

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
    const el = wrapRef.current
    if (!el) return
    const sync = () => setWrapRect(el.getBoundingClientRect())
    sync()
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
    }
  }, [size.w, size.h])

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

  useEffect(() => {
    const onUp = () => {
      const d = pencilDraftRef.current
      if (!d) return
      setPencilDraft(null)
      pencilDraftRef.current = null
      if ((d.points?.length ?? 0) < 4) return
      commit((st) => {
        st.elements.push(d)
      })
      setActiveTool('select')
      setSelectedIds([d.id])
    }
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [commit])

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
          if (el.parentFolderId) return false
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
      e.evt.button === 0 &&
      !spaceDown.current &&
      activeTool === 'pencil' &&
      !editing
    ) {
      const w = worldFromPointer(stage, viewportMemo)
      if (!w) return
      e.cancelBubble = true
      setSelectedConnectorId(null)
      setSelectedIds([])
      const id = crypto.randomUUID()
      const sw = Math.max(1, Math.round(pencilSize))
      setPencilDraft({
        id,
        kind: 'pencil',
        x: w.wx,
        y: w.wy,
        width: 1,
        height: 1,
        text: '',
        color: pencilColor,
        strokeWidth: sw,
        points: [0, 0],
      })
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
    if (pencilDraftRef.current) {
      const stage = e.target.getStage()
      if (!stage) return
      const w = worldFromPointer(stage, viewportMemo)
      if (!w) return
      const d = pencilDraftRef.current
      const pts = d.points ?? []
      const lastX = (pts[pts.length - 2] ?? 0) + d.x
      const lastY = (pts[pts.length - 1] ?? 0) + d.y
      const dx = w.wx - lastX
      const dy = w.wy - lastY
      if (dx * dx + dy * dy < 0.75 * 0.75) return

      const absPts: number[] = []
      for (let i = 0; i < pts.length; i += 2) {
        absPts.push(pts[i]! + d.x, pts[i + 1]! + d.y)
      }
      absPts.push(w.wx, w.wy)

      let minX = absPts[0] ?? w.wx
      let minY = absPts[1] ?? w.wy
      let maxX = minX
      let maxY = minY
      for (let i = 0; i < absPts.length; i += 2) {
        const x = absPts[i]!
        const y = absPts[i + 1]!
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }

      const sw = d.strokeWidth ?? 4
      const pad = sw / 2 + 2
      const nx = minX - pad
      const ny = minY - pad
      const local: number[] = []
      for (let i = 0; i < absPts.length; i += 2) {
        local.push(absPts[i]! - nx, absPts[i + 1]! - ny)
      }
      setPencilDraft({
        ...d,
        x: nx,
        y: ny,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
        points: local,
      })
      return
    }
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
        const sel = effectiveSelectedIdsRef.current
        if (sel.length === 1) {
          const hit = stateRef.current.elements.find((x) => x.id === sel[0])
          if (hit?.kind === 'folder') {
            e.preventDefault()
            openFolderViewer(hit)
            return
          }
        }
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
        if (folderViewerIdRef.current) {
          closeFolderViewer()
          return
        }
        if (folderNamingRef.current) {
          setFolderNaming(null)
          return
        }
        if (infoModalOpen) {
          setInfoModalOpen(false)
          return
        }
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
  }, [
    activeTool,
    clearMarqueeSession,
    closeFolderViewer,
    infoModalOpen,
    openFolderViewer,
    redo,
    undo,
  ])

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
        d.connectors = d.connectors.filter(
          (c) => !remove.has(c.fromId) && !remove.has(c.toId),
        )
        for (const x of d.elements) {
          if (x.parentFolderId && remove.has(x.parentFolderId)) {
            delete x.parentFolderId
          }
        }
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
      if (activeTool === 'pencil') return
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
    setFolderMergeHintTargetId(null)
    const sess = dragSession.current
    dragSession.current = null
    setDragPreviewById(null)
    const tryDropIntoFolder = (draggedId: string, dropX: number, dropY: number) => {
      const dragged = stateRef.current.elements.find((e) => e.id === draggedId)
      if (!dragged || dragged.kind !== 'image' || dragged.parentFolderId) return false
      const draggedRect: CanvasElement = { ...dragged, x: dropX, y: dropY }
      let best: { id: string; area: number } | null = null
      for (const other of stateRef.current.elements) {
        if (other.kind !== 'folder') continue
        if (!folderDropHit(draggedRect, other)) continue
        const area = rectIntersectionArea(
          draggedRect.x,
          draggedRect.y,
          draggedRect.width,
          draggedRect.height,
          other.x,
          other.y,
          other.width,
          other.height,
        )
        if (!best || area > best.area) best = { id: other.id, area }
      }
      if (!best) return false
      const folderId = best.id
      commit((d) => {
        const found = d.elements.find((z) => z.id === draggedId)
        const folder = d.elements.find((z) => z.id === folderId)
        if (!found || !folder || folder.kind !== 'folder') return
        found.parentFolderId = folderId
        d.connectors = d.connectors.filter(
          (c) => c.fromId !== draggedId && c.toId !== draggedId,
        )
      })
      setSelectedIds([folderId])
      return true
    }
    if (!sess || sess.draggedId !== id) {
      flushSync(() => {
        commit((d) => {
          const found = d.elements.find((z) => z.id === id)
          if (found) {
            found.x = x
            found.y = y
          }
        })
      })
      if (tryDropIntoFolder(id, x, y)) return
      tryQueueFolderMerge(id, null)
      return
    }
    const origDragged = sess.origById.get(id)
    if (!origDragged) return
    const dx = x - origDragged.x
    const dy = y - origDragged.y
    flushSync(() => {
      commit((d) => {
        for (const sid of sess.ids) {
          const found = d.elements.find((z) => z.id === sid)
          const orig = sess.origById.get(sid)
          if (found && orig) {
            found.x = orig.x + dx
            found.y = orig.y + dy
          }
        }
      })
    })
    if (sess.ids.length === 1 && tryDropIntoFolder(id, x, y)) return
    tryQueueFolderMerge(id, sess)
  }

  const onDragStart = (id: string) => {
    setDraggingElementId(id)
    setFolderMergeHintTargetId(null)
    updateCursor()
    setSelectedConnectorId(null)
    setSelectedIds((cur) => {
      if (cur.includes(id)) return cur
      return [id]
    })
    const ids = expandDragIdsWithFolderContents(
      effectiveSelectedIdsRef.current.includes(id)
        ? effectiveSelectedIdsRef.current
        : [id],
      stateRef.current.elements,
    )
    const origById = new Map<string, { x: number; y: number }>()
    for (const el of stateRef.current.elements) {
      if (ids.includes(el.id)) origById.set(el.id, { x: el.x, y: el.y })
    }
    dragSession.current = { draggedId: id, ids, origById }
  }

  const onDragMove = (id: string, x: number, y: number) => {
    const sess = dragSession.current
    if (!sess || sess.draggedId !== id) return
    const origDragged = sess.origById.get(id)
    if (!origDragged) return
    const dx = x - origDragged.x
    const dy = y - origDragged.y
    const next: Record<string, { x: number; y: number }> = {}
    for (const sid of sess.ids) {
      const orig = sess.origById.get(sid)
      if (!orig) continue
      next[sid] = { x: orig.x + dx, y: orig.y + dy }
    }
    setDragPreviewById(next)

    // Folder merge hint: dragging an image over another image shows a "+" badge.
    if (sess.ids.length === 1) {
      const dragged = stateRef.current.elements.find((e) => e.id === id)
      const draggedPreview = next[id]
      if (
        dragged &&
        dragged.kind === 'image' &&
        !dragged.parentFolderId &&
        draggedPreview
      ) {
        const draggedRect: CanvasElement = {
          ...dragged,
          x: draggedPreview.x,
          y: draggedPreview.y,
        }
        let bestOther: { id: string; area: number } | null = null
        for (const other of stateRef.current.elements) {
          if (other.id === id) continue
          if (other.kind === 'image') {
            if (other.parentFolderId) continue
            if (!folderMergeHit(draggedRect, other)) continue
          } else if (other.kind === 'folder') {
            if (!folderDropHit(draggedRect, other)) continue
          } else {
            continue
          }
          const area = rectIntersectionArea(
            draggedRect.x,
            draggedRect.y,
            draggedRect.width,
            draggedRect.height,
            other.x,
            other.y,
            other.width,
            other.height,
          )
          if (!bestOther || area > bestOther.area) {
            bestOther = { id: other.id, area }
          }
        }
        setFolderMergeHintTargetId(bestOther?.id ?? null)
      } else {
        setFolderMergeHintTargetId(null)
      }
    } else {
      setFolderMergeHintTargetId(null)
    }
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
  const [editTextColor, setEditTextColor] = useState<string>(TEXT_COLORS[7])
  const [editLayout, setEditLayout] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [editLayoutTick, setEditLayoutTick] = useState(0)
  const textEditRef = useRef<HTMLTextAreaElement | null>(null)
  const folderRenameInputRef = useRef<HTMLInputElement | null>(null)
  const [textColorMenuOpen, setTextColorMenuOpen] = useState(false)
  const textColorMenuRef = useRef<HTMLDivElement>(null)
  /** Text formatting toolbar (font/size selects); blur deferral avoids closing before native `<select>` opens. */
  const textToolbarRef = useRef<HTMLDivElement>(null)

  const editingId = editing?.id ?? null
  const editingLive =
    editingId != null
      ? (state.elements.find((e) => e.id === editingId) ?? editing)
      : null

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
      if (editingLive.kind === 'folder') {
        let d: CanvasElement = editingLive
        if (dragPreviewById && dragPreviewById[editingLive.id]) {
          const p = dragPreviewById[editingLive.id]!
          d = { ...editingLive, x: p.x, y: p.y }
        } else if (resizePreview && resizePreview.id === editingLive.id) {
          d = resizePreview
        }
        setEditLayout(folderTitleScreenRect(stage, d, viewportMemo))
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
    dragPreviewById,
    resizePreview,
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

  const textareaPaddingStyle: CSSProperties = (() => {
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
    if (editing.kind === 'folder') {
      return { padding: '0 4px' }
    }
    return { padding: '12px', paddingLeft: 20 }
  })()

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
        if (ae === folderRenameInputRef.current) return
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
      if (dragPreviewById && dragPreviewById[el.id]) {
        const p = dragPreviewById[el.id]!
        return { ...el, x: p.x, y: p.y }
      }
      if (resizePreview && resizePreview.id === el.id) return resizePreview
      return el
    },
    [resizePreview, dragPreviewById],
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
        if (el.parentFolderId) continue
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
      setActiveTool('select')
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
          : firstSelectedKind === 'text' || firstSelectedKind === 'pencil'
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
        setActiveTool('select')
        setSelectedIds(additions.map((x) => x.id))
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
    if (editingId != null) {
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
    editingId,
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
      if (el.parentFolderId) continue
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

  const dotStepPx = SCREEN_DOT_GRID_STEP_PX
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

  const modalPortal =
    typeof document !== 'undefined'
      ? createPortal(
          <>
            {folderNaming ? (
              <div
                role="presentation"
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 12060,
                  background: 'rgba(15, 23, 42, 0.42)',
                  backdropFilter: 'blur(6px)',
                  WebkitBackdropFilter: 'blur(6px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setFolderNaming(null)
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Name folder"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    maxWidth: 380,
                    background: 'rgba(255,255,255,0.92)',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.65)',
                    boxShadow:
                      '0 24px 64px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.8)',
                    padding: '22px 22px 18px',
                    fontFamily: UI_SANS,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <img
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(MAC_FOLDER_SVG_MARKUP)}`}
                      alt=""
                      width={36}
                      height={30}
                      draggable={false}
                      style={{ flexShrink: 0 }}
                    />
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 17,
                        fontWeight: 600,
                        color: '#111827',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      New folder
                    </h2>
                  </div>
                  <label
                    htmlFor="folium-folder-name"
                    style={{ display: 'block', fontSize: 12, color: '#6b7280', marginBottom: 6 }}
                  >
                    Name
                  </label>
                  <input
                    ref={folderNameInputRef}
                    id="folium-folder-name"
                    type="text"
                    value={folderNameDraft}
                    onChange={(e) => setFolderNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        confirmFolderNaming()
                      }
                    }}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      fontSize: 14,
                      borderRadius: 10,
                      border: '1px solid rgba(0,0,0,0.1)',
                      background: 'rgba(255,255,255,0.9)',
                      fontFamily: UI_SANS,
                      color: '#111827',
                      outline: 'none',
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 10,
                      marginTop: 18,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setFolderNaming(null)}
                      style={{
                        padding: '8px 14px',
                        fontSize: 13,
                        fontWeight: 500,
                        borderRadius: 10,
                        border: 'none',
                        background: 'rgba(0,0,0,0.06)',
                        color: '#374151',
                        cursor: 'pointer',
                        fontFamily: UI_SANS,
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmFolderNaming()}
                      style={{
                        padding: '8px 16px',
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 10,
                        border: 'none',
                        background: 'linear-gradient(180deg, #4f8fff 0%, #2f6eeb 100%)',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontFamily: UI_SANS,
                        boxShadow: '0 2px 8px rgba(47,110,235,0.35)',
                      }}
                    >
                      Create
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {folderViewerId && folderViewerFolder && folderViewerFolder.kind === 'folder' ? (
              <div
                role="presentation"
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 12050,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding:
                    'max(20px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left))',
                }}
              >
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(10, 14, 28, 0.42)',
                    backdropFilter: 'blur(56px) saturate(190%)',
                    WebkitBackdropFilter: 'blur(56px) saturate(190%)',
                    opacity: folderViewerEntered ? 1 : 0,
                    transition: 'opacity 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                  onMouseDown={closeFolderViewer}
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={folderViewerFolder.text || 'Folder'}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    width: 'min(1120px, 100%)',
                    height: 'min(88vh, 920px)',
                    maxHeight: '100%',
                    borderRadius: 32,
                    background:
                      'linear-gradient(165deg, rgba(255,255,255,0.72) 0%, rgba(245,248,255,0.58) 100%)',
                    backdropFilter: 'blur(28px) saturate(165%)',
                    WebkitBackdropFilter: 'blur(28px) saturate(165%)',
                    border: '1px solid rgba(255,255,255,0.62)',
                    boxShadow:
                      '0 32px 96px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 0 0 1px rgba(255,255,255,0.25)',
                    transform: folderViewerEntered
                      ? 'scale(1) translateY(0)'
                      : 'scale(0.86) translateY(28px)',
                    opacity: folderViewerEntered ? 1 : 0,
                    transition:
                      'transform 0.52s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.42s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    fontFamily: UI_SANS,
                  }}
                >
                  <header
                    style={{
                      flexShrink: 0,
                      position: 'sticky',
                      top: 0,
                      zIndex: 2,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '18px 20px 14px',
                      background: 'rgba(255,255,255,0.42)',
                      backdropFilter: 'blur(32px) saturate(185%)',
                      WebkitBackdropFilter: 'blur(32px) saturate(185%)',
                      borderBottom: '1px solid rgba(255,255,255,0.45)',
                      boxShadow:
                        'inset 0 1px 0 rgba(255,255,255,0.65), 0 8px 32px rgba(0,0,0,0.04)',
                    }}
                  >
                    <img
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(MAC_FOLDER_SVG_MARKUP)}`}
                      alt=""
                      width={40}
                      height={33}
                      draggable={false}
                      style={{
                        flexShrink: 0,
                        cursor: 'default',
                        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))',
                      }}
                    />
                    <h2
                      style={{
                        flex: 1,
                        margin: 0,
                        fontSize: 20,
                        fontWeight: 600,
                        color: '#0f172a',
                        letterSpacing: '-0.03em',
                      }}
                    >
                      {folderViewerFolder.text}
                    </h2>
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={closeFolderViewer}
                      style={{
                        width: 36,
                        height: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        border: 'none',
                        borderRadius: 12,
                        background: 'rgba(0,0,0,0.05)',
                        color: '#475569',
                        cursor: 'pointer',
                      }}
                    >
                      <X size={20} strokeWidth={2} aria-hidden />
                    </button>
                  </header>
                  <div
                    style={{
                      flex: 1,
                      overflow: 'auto',
                      padding: 18,
                      boxSizing: 'border-box',
                    }}
                  >
                    {folderViewerChildren.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>
                        No images in this folder.
                      </p>
                    ) : (
                      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div
                          style={{
                            position: 'relative',
                            flex: 1,
                            minHeight: 220,
                            borderRadius: 22,
                            overflow: 'hidden',
                            background: 'rgba(255,255,255,0.55)',
                            border: '1px solid rgba(0,0,0,0.06)',
                            boxShadow: '0 18px 48px rgba(0,0,0,0.10)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {folderViewerActiveImage?.imageSrc ? (
                            <img
                              src={folderViewerActiveImage.imageSrc}
                              alt=""
                              draggable={false}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                background: 'transparent',
                                userSelect: 'none',
                              }}
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', background: '#e2e8f0' }} />
                          )}

                          {folderViewerChildren.length > 1 ? (
                            <>
                              <button
                                type="button"
                                aria-label="Previous image"
                                onClick={() => goFolderViewer(-1)}
                                style={{
                                  position: 'absolute',
                                  left: 14,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  width: 40,
                                  height: 40,
                                  borderRadius: 999,
                                  border: '1px solid rgba(255,255,255,0.6)',
                                  background: 'rgba(15,23,42,0.28)',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  backdropFilter: 'blur(10px) saturate(160%)',
                                  WebkitBackdropFilter: 'blur(10px) saturate(160%)',
                                }}
                              >
                                <ChevronLeft size={18} strokeWidth={2.2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                aria-label="Next image"
                                onClick={() => goFolderViewer(1)}
                                style={{
                                  position: 'absolute',
                                  right: 14,
                                  top: '50%',
                                  transform: 'translateY(-50%)',
                                  width: 40,
                                  height: 40,
                                  borderRadius: 999,
                                  border: '1px solid rgba(255,255,255,0.6)',
                                  background: 'rgba(15,23,42,0.28)',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  backdropFilter: 'blur(10px) saturate(160%)',
                                  WebkitBackdropFilter: 'blur(10px) saturate(160%)',
                                }}
                              >
                                <ChevronRight size={18} strokeWidth={2.2} aria-hidden />
                              </button>
                            </>
                          ) : null}

                          <div
                            aria-hidden
                            style={{
                              position: 'absolute',
                              left: 14,
                              bottom: 12,
                              padding: '6px 10px',
                              borderRadius: 999,
                              background: 'rgba(15,23,42,0.28)',
                              color: 'rgba(255,255,255,0.92)',
                              fontSize: 12,
                              fontWeight: 500,
                              letterSpacing: '-0.01em',
                              backdropFilter: 'blur(10px) saturate(160%)',
                              WebkitBackdropFilter: 'blur(10px) saturate(160%)',
                            }}
                          >
                            {folderViewerActiveIndex + 1} / {folderViewerChildren.length}
                          </div>
                        </div>

                        <div
                          ref={folderViewerThumbsRef}
                          style={{
                            flexShrink: 0,
                            display: 'flex',
                            gap: 10,
                            padding: '6px 2px 2px',
                            overflowX: 'auto',
                            overflowY: 'hidden',
                            WebkitOverflowScrolling: 'touch',
                            scrollSnapType: 'x mandatory',
                          }}
                        >
                          {folderViewerChildren.map((ch, i) => {
                            const active =
                              (folderViewerActiveImage?.id ?? folderViewerChildren[0]?.id) === ch.id
                            return (
                              <button
                                key={ch.id}
                                type="button"
                                data-thumb-id={ch.id}
                                aria-label={`Image ${i + 1}`}
                                onClick={() => setFolderViewerActiveImageId(ch.id)}
                                style={{
                                  scrollSnapAlign: 'center',
                                  width: 74,
                                  height: 54,
                                  borderRadius: 12,
                                  overflow: 'hidden',
                                  border: active
                                    ? '2px solid #3b82f6'
                                    : '1px solid rgba(0,0,0,0.10)',
                                  background: 'rgba(255,255,255,0.65)',
                                  boxShadow: active
                                    ? '0 8px 22px rgba(59,130,246,0.18)'
                                    : '0 6px 18px rgba(0,0,0,0.08)',
                                  padding: 0,
                                  cursor: 'pointer',
                                }}
                              >
                                {ch.imageSrc ? (
                                  <img
                                    src={ch.imageSrc}
                                    alt=""
                                    draggable={false}
                                    loading="lazy"
                                    style={{
                                      display: 'block',
                                      width: '100%',
                                      height: '100%',
                                      objectFit: 'cover',
                                    }}
                                  />
                                ) : (
                                  <div style={{ width: '100%', height: '100%', background: '#e2e8f0' }} />
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {infoModalOpen ? (
              <div
                role="presentation"
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 12040,
                  background: 'rgba(15, 23, 42, 0.45)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                  pointerEvents: 'auto',
                }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget) setInfoModalOpen(false)
                }}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={`About ${APP_DISPLAY_NAME}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'relative',
                    width: '100%',
                    maxWidth: 400,
                    background: 'rgba(255,255,255,0.94)',
                    backdropFilter: 'blur(16px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(16px) saturate(150%)',
                    borderRadius: 12,
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.18)',
                    padding: '22px 44px 20px 22px',
                    fontFamily: UI_SANS,
                    color: '#111827',
                  }}
                >
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setInfoModalOpen(false)}
                    style={{
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 32,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      border: 'none',
                      borderRadius: 8,
                      background: 'transparent',
                      color: '#6b7280',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f3f4f6'
                      e.currentTarget.style.color = '#111827'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = '#6b7280'
                    }}
                  >
                    <X size={18} strokeWidth={2} aria-hidden />
                  </button>
                  <div style={{ marginBottom: 14 }}>
                    <img
                      src="/logo.svg"
                      alt={APP_DISPLAY_NAME}
                      width={108}
                      height={31}
                      draggable={false}
                      style={{
                        display: 'block',
                        height: 28,
                        width: 'auto',
                        maxWidth: '100%',
                      }}
                    />
                  </div>
                  <p style={{ margin: '10px 0 0', fontSize: 13, color: '#6b7280' }}>
                    Version <strong style={{ color: '#374151' }}>{APP_VERSION}</strong>
                  </p>
                  <p
                    style={{
                      margin: '14px 0 0',
                      fontSize: 13,
                      lineHeight: 1.55,
                      color: '#374151',
                    }}
                  >
                    © {new Date().getFullYear()} {APP_DISPLAY_NAME}. All rights reserved.
                  </p>
                  <p
                    style={{
                      margin: '12px 0 0',
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: '#6b7280',
                    }}
                  >
                    This software is provided for your use as-is. Third-party libraries used in
                    this project retain their respective licenses.
                  </p>
                </div>
              </div>
            ) : null}
          </>,
          document.body,
        )
      : null

  return (
    <>
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
          {rootElements.map((el) => (
            <CanvasElementNode
              key={el.id}
              el={el}
              display={displayElement(el)}
              selected={effectiveSelectedIds.includes(el.id)}
              editing={editing?.id === el.id}
              handMode={handMode}
              folderMergeHintTargetId={folderMergeHintTargetId}
              draggingElementId={draggingElementId}
              onSelect={(id, evt) => {
                setSelectedConnectorId(null)
                const additive = evt.shiftKey || evt.metaKey || evt.ctrlKey
                if (!additive) {
                  setSelectedIds([id])
                  return
                }
                setSelectedIds((cur) => {
                  if (cur.includes(id)) return cur.filter((x) => x !== id)
                  return [...cur, id]
                })
              }}
              onDragStart={onDragStart}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onEditRequest={onEditRequest}
              onFolderOpen={openFolderViewer}
            />
          ))}
          {pencilDraft ? (
            <CanvasElementNode
              key={pencilDraft.id}
              el={pencilDraft}
              display={pencilDraft}
              selected={false}
              editing={false}
              handMode={true}
              folderMergeHintTargetId={null}
              draggingElementId={null}
              onSelect={() => {}}
              onDragStart={() => {}}
              onDragMove={() => {}}
              onDragEnd={() => {}}
              onEditRequest={() => {}}
              onFolderOpen={() => {}}
            />
          ) : null}
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
        if (!wrapRect) return null
        const canShow =
          editing === null &&
          activeTool !== 'note' &&
          activeTool !== 'card' &&
          activeTool !== 'task' &&
          activeTool !== 'text' &&
          draggingElementId === null

        if (!canShow) return null

        const showingAll = activeTool === 'connect'
        if (!showingAll) {
          const targetId = hoveredElementId
          if (!targetId) return null
          if (effectiveSelectedIds.includes(targetId)) return null
          const ids = [targetId]
          const anchors: Anchor[] = ['top', 'right', 'bottom', 'left']
          const s = viewportMemo
          return ids.flatMap((id) => {
            const el = elementById.get(id)
            if (!el) return []
            return anchors.map((a) => {
              const key = `${id}:${a}`
              const wpos = anchorWorldPos(el, a)
              const p = screenPointFromRect(wrapRect, wpos, s)
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
                  onMouseLeave={() =>
                    setHoveredAnchorKey((cur) => (cur === key ? null : cur))
                  }
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
                    boxShadow: snapped
                      ? '0 0 0 3px rgba(59,130,246,0.25)'
                      : undefined,
                  }}
                />
              )
            })
          })
        }

        const ids = rootElements.map((e) => e.id)

        const anchors: Anchor[] = ['top', 'right', 'bottom', 'left']
        const s = viewportMemo
        return ids.flatMap((id) => {
          const el = elementById.get(id)
          if (!el) return []
          return anchors.map((a) => {
            const key = `${id}:${a}`
            const wpos = anchorWorldPos(el, a)
            const p = screenPointFromRect(wrapRect, wpos, s)
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

      {(() => {
        if (!wrapRect) return null
        if (!folderMergeHintTargetId) return null
        if (!draggingElementId) return null
        const el = elementById.get(folderMergeHintTargetId)
        if (!el) return null
        const s = viewportMemo
        const center = { x: el.x + el.width / 2, y: el.y + el.height / 2 }
        const p = screenPointFromRect(wrapRect, center, s)
        return (
          <div
            aria-hidden
            style={{
              position: 'fixed',
              left: p.left - 34,
              top: p.top - 34,
              width: 68,
              height: 68,
              borderRadius: 999,
              background: 'linear-gradient(180deg, #34d399 0%, #16a34a 100%)',
              boxShadow:
                '0 22px 56px rgba(22,163,74,0.35), 0 0 0 6px rgba(255,255,255,0.55)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: UI_SANS,
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1,
              zIndex: 12010,
              pointerEvents: 'none',
              transform: 'scale(1)',
              opacity: 1,
              transition:
                'transform 160ms cubic-bezier(0.16, 1, 0.3, 1), opacity 160ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            +
          </div>
        )
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

      {editLayout && editing?.kind === 'folder' ? (
        <input
          ref={folderRenameInputRef}
          type="text"
          aria-label="Folder name"
          style={{
            position: 'fixed',
            left: editLayout.left,
            top: editLayout.top,
            width: editLayout.width,
            height: editLayout.height,
            zIndex: 1200,
            fontSize: Math.max(12, Math.round(11 * viewportMemo.scale)),
            fontFamily: UI_SANS,
            color: '#374151',
            border: 'none',
            outline: 'none',
            background: 'rgba(255,255,255,0.96)',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            boxShadow: '0 0 0 2px #3b82f6',
            borderRadius: 6,
            ...textareaPaddingStyle,
          }}
          value={editText}
          onChange={(ev: ChangeEvent<HTMLInputElement>) =>
            setEditText(ev.target.value)
          }
          onBlur={handleTextareaBlur}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') {
              ev.preventDefault()
              closeEdit()
            }
            if (ev.key === 'Enter') {
              ev.preventDefault()
              closeEdit()
            }
          }}
          autoFocus
        />
      ) : editLayout ? (
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
          title="Pencil"
          style={{
            ...toolBtnBase,
            background: activeTool === 'pencil' ? '#eff6ff' : 'transparent',
            color: activeTool === 'pencil' ? '#3b82f6' : '#374151',
          }}
          onMouseEnter={(e) => {
            if (activeTool !== 'pencil')
              e.currentTarget.style.background = '#f3f4f6'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              activeTool === 'pencil' ? '#eff6ff' : 'transparent'
          }}
          onClick={() => setActiveTool('pencil')}
        >
          <Pencil size={SIDENAV_ICON_PX} strokeWidth={1.75} aria-hidden />
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

      {activeTool === 'pencil' ? (
        <div style={{ ...swatchPanelStyle, gap: 10, padding: '10px 12px' }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              maxWidth: 220,
            }}
          >
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                style={{
                  ...swatchBtn,
                  background: c,
                  boxShadow:
                    pencilColor === c
                      ? '0 0 0 2px rgba(59,130,246,0.85)'
                      : swatchBtn.boxShadow,
                }}
                onClick={() => setPencilColor(c)}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {[2, 4, 8, 12].map((s) => (
              <button
                key={s}
                type="button"
                title={`Size ${s}`}
                onClick={() => setPencilSize(s)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  border: '1px solid rgba(0,0,0,0.08)',
                  background: pencilSize === s ? '#eff6ff' : '#ffffff',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: s + 6,
                    height: s + 6,
                    borderRadius: 999,
                    background: pencilColor,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div style={canvasBottomRightClusterStyle}>
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
        <div style={infoCtaBarStyle}>
          <button
            type="button"
            title="About Folium"
            aria-haspopup="dialog"
            aria-expanded={infoModalOpen}
            style={zoomBtnStyle}
            onClick={() => setInfoModalOpen(true)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f3f4f6'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <CircleHelp size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
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
    {modalPortal}
    </>
  )
}
