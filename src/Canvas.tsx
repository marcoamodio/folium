import Konva from 'konva'
import type { CSSProperties } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva'
import { subscribeCanvasPersistence } from './canvasPersistence'
import type { CanvasElement, CanvasState, ElementKind } from './types'
import {
  CARD_COLORS,
  ELEMENT_DEFAULTS,
  NOTE_COLORS,
  TASK_ACCENT_COLORS,
} from './types'
import { useCanvasHistory } from './useCanvasHistory'

const SCALE_MIN = 0.1
const SCALE_MAX = 4
const GRID_STEP = 24
const NOTE_HEADER = 32
const MIN_ELEMENT_W = 80
const MIN_ELEMENT_H = 40
const MARQUEE_THRESHOLD = 5
const HANDLE_SIZE = 8

type ActiveTool = 'select' | 'note' | 'task' | 'card'
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function createElement(kind: ElementKind, cx: number, cy: number): CanvasElement {
  const d = ELEMENT_DEFAULTS[kind]
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

function visibleWorldBounds(
  w: number,
  h: number,
  vx: number,
  vy: number,
  scale: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const pad = 200
  return {
    minX: (-vx) / scale - pad,
    maxX: (w - vx) / scale + pad,
    minY: (-vy) / scale - pad,
    maxY: (h - vy) / scale + pad,
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

type GridDotsProps = {
  width: number
  height: number
  vx: number
  vy: number
  scale: number
}

function GridDots({ width, height, vx, vy, scale }: GridDotsProps) {
  const { minX, maxX, minY, maxY } = visibleWorldBounds(
    width,
    height,
    vx,
    vy,
    scale,
  )
  const gx0 = Math.floor(minX / GRID_STEP) * GRID_STEP
  const gy0 = Math.floor(minY / GRID_STEP) * GRID_STEP
  const dotCount =
    ((maxX - gx0) / GRID_STEP + 1) * ((maxY - gy0) / GRID_STEP + 1)
  if (dotCount > 8000) return null

  const dots: { cx: number; cy: number }[] = []
  for (let x = gx0; x <= maxX; x += GRID_STEP) {
    for (let y = gy0; y <= maxY; y += GRID_STEP) {
      dots.push({ cx: x, cy: y })
    }
  }

  return (
    <>
      {dots.map((d, i) => (
        <Circle
          key={`${d.cx}-${d.cy}-${i}`}
          x={d.cx}
          y={d.cy}
          radius={1}
          fill="#d4d4d4"
          listening={false}
        />
      ))}
    </>
  )
}

type CanvasElementNodeProps = {
  el: CanvasElement
  display: CanvasElement
  selected: boolean
  editing: boolean
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
  onSelect,
  onDragStart,
  onDragEnd,
  onEditRequest,
}: CanvasElementNodeProps) {
  if (display.kind === 'note') {
    return (
      <Group
        x={display.x}
        y={display.y}
        draggable
        onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true
        }}
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
        draggable
        onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
          e.cancelBubble = true
        }}
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

  return (
    <Group
      x={display.x}
      y={display.y}
      draggable
      onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true
      }}
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
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onHoverHandle,
}: {
  el: CanvasElement
  viewport: CanvasState['viewport']
  onResizeStart: (handle: HandleId) => void
  onResizeMove: (handle: HandleId, wx: number, wy: number) => void
  onResizeEnd: () => void
  onHoverHandle: (handle: HandleId | null) => void
}) {
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
            draggable
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

const leftToolbarStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  top: '50%',
  transform: 'translateY(-50%)',
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '8px 6px',
  background: '#ffffff',
  borderRadius: 12,
  border: '1px solid #e5e7eb',
  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
}

const toolBtnBase: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  color: '#374151',
}

const swatchPanelStyle: CSSProperties = {
  position: 'fixed',
  left: 72,
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

function IconNote() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="currentColor"
        d="M4 3h10a2 2 0 0 1 2 2v9l-3-3H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
      />
    </svg>
  )
}

function IconCard() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <rect
        x="3"
        y="5"
        width="14"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

function IconTask() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M6 10l2.5 2.5L14 7M4 5h12M4 8h8"
      />
    </svg>
  )
}

function IconSelect() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        d="M3 3l7 14 2-6 6-2L3 3z"
      />
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
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
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

  const listenersRef = useRef(new Set<() => void>())
  const emit = useCallback(() => {
    listenersRef.current.forEach((fn) => fn())
  }, [])

  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

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
    const name = e.target.name()
    const canPan =
      name === 'folium-bg' &&
      (e.evt.button === 1 || (e.evt.button === 0 && spaceDown.current))
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
      name === 'folium-bg' &&
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
      if (e.code === 'Space') spaceDown.current = true
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if (e.key === 'Escape') {
        setActiveTool('select')
        clearMarqueeSession()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [undo, redo, clearMarqueeSession])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ids = effectiveSelectedIdsRef.current
      if (ids.length === 0) return
      const active = document.activeElement?.tagName
      if (active === 'INPUT' || active === 'TEXTAREA') return
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      e.preventDefault()
      const remove = new Set(ids)
      setSelectedIds([])
      commit((d) => {
        d.elements = d.elements.filter((x) => !remove.has(x.id))
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    if (!stage) return
    const oldScale = state.viewport.scale
    const scaleBy = 1.08
    const newScale = clamp(
      e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy,
      SCALE_MIN,
      SCALE_MAX,
    )
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const mousePointTo = {
      x: (pointer.x - state.viewport.x) / oldScale,
      y: (pointer.y - state.viewport.y) / oldScale,
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
  }

  const onBgClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target.name() !== 'folium-bg') return
    if (e.evt.button !== 0) return
    if (activeTool !== 'select') {
      const stage = e.target.getStage()
      if (!stage) return
      const w = worldFromPointer(stage, viewportMemo)
      if (!w) return
      const next = createElement(activeTool, w.wx, w.wy)
      commit((d) => {
        d.elements.push(next)
      })
      setActiveTool('select')
      setSelectedIds([next.id])
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
  const [editLayout, setEditLayout] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

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
      setEditLayout(screenRectFromStage(stage, editingLive, viewportMemo))
    }
    const id = requestAnimationFrame(apply)
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
  }, [editingLive, viewportMemo, size.w, size.h])

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
    return { padding: '12px', paddingLeft: 20 }
  }, [editing])

  const onEditRequest = (el: CanvasElement) => {
    setEditing(el)
    setEditText(el.text)
  }

  const closeEdit = () => {
    if (!editing) return
    const id = editing.id
    const text = editText
    setEditing(null)
    commit((d) => {
      const found = d.elements.find((x) => x.id === id)
      if (found) found.text = text
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
          : []

  const updateCursor = useCallback(() => {
    const container = stageRef.current?.container()
    if (!container) return
    if (editing) {
      container.style.cursor = 'default'
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
    if (spaceDown.current) {
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
    draggingElementId,
    editing,
    hoverElement,
    hoverHandle,
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
      updateCursor()
      return
    }
    let overEl = false
    for (const el of state.elements) {
      const d = displayElement(el)
      if (
        p.wx >= d.x &&
        p.wx <= d.x + d.width &&
        p.wy >= d.y &&
        p.wy <= d.y + d.height
      ) {
        overEl = true
        break
      }
    }
    setHoverElement(overEl)
    updateCursor()
  }

  const normMarquee = marquee ? normalizeMarquee(marquee.x, marquee.y, marquee.width, marquee.height) : null

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        touchAction: 'none',
        backgroundColor: '#f8f8f8',
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={vx}
        y={vy}
        scaleX={vScale}
        scaleY={vScale}
        onMouseDown={handleStageMouseDown}
        onMouseMove={onStageMouseMoveCursor}
        onWheel={onWheel}
      >
        <Layer listening={false}>
          <GridDots
            width={size.w}
            height={size.h}
            vx={vx}
            vy={vy}
            scale={vScale}
          />
        </Layer>
        <Layer>
          <Rect
            name="folium-bg"
            x={-1e6}
            y={-1e6}
            width={2e6}
            height={2e6}
            fill="#f8f8f8"
            listening
            onClick={onBgClick}
          />
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
          {state.elements.map((el) => (
            <CanvasElementNode
              key={el.id}
              el={el}
              display={displayElement(el)}
              selected={effectiveSelectedIds.includes(el.id)}
              editing={editing?.id === el.id}
              onSelect={(id) => setSelectedIds([id])}
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
              onResizeStart={onResizeStart}
              onResizeMove={onResizeMove}
              onResizeEnd={onResizeEnd}
              onHoverHandle={setHoverHandle}
            />
          </Layer>
        ) : null}
      </Stage>

      {editLayout ? (
        <textarea
          style={{
            position: 'fixed',
            left: editLayout.left,
            top: editLayout.top,
            width: editLayout.width,
            height: editLayout.height,
            zIndex: 1200,
            resize: 'none',
            fontSize: 13,
            fontFamily: 'system-ui, Inter, sans-serif',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            boxSizing: 'border-box',
            pointerEvents: 'auto',
            ...textareaPaddingStyle,
          }}
          value={editText}
          onChange={(ev) => setEditText(ev.target.value)}
          onBlur={closeEdit}
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
          <IconSelect />
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
          <IconNote />
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
          <IconCard />
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
          <IconTask />
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
    </div>
  )
}
