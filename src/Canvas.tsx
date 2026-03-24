import Konva from 'konva'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Group, Layer, Rect, Stage, Text } from 'react-konva'
import { subscribeCanvasPersistence } from './canvasPersistence'
import type { CanvasElement, CanvasState, ElementKind } from './types'
import { useCanvasHistory } from './useCanvasHistory'

const SCALE_MIN = 0.1
const SCALE_MAX = 4

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function createElement(kind: ElementKind, cx: number, cy: number): CanvasElement {
  const dims: Record<ElementKind, [number, number]> = {
    note: [200, 150],
    task: [200, 40],
    card: [160, 100],
  }
  const [w, h] = dims[kind]
  const defaults: Record<ElementKind, string> = {
    note: 'Note',
    task: '• Task',
    card: 'Card',
  }
  return {
    id: crypto.randomUUID(),
    kind,
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    text: defaults[kind],
    color: kind === 'note' ? '#fef08a' : '#ffffff',
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

function screenRectForElementInContainer(
  containerRect: DOMRectReadOnly,
  el: CanvasElement,
  viewport: CanvasState['viewport'],
): { left: number; top: number; width: number; height: number } {
  const s = viewport.scale
  const { x: px, y: py } = viewport
  return {
    left: containerRect.left + el.x * s + px,
    top: containerRect.top + el.y * s + py,
    width: el.width * s,
    height: el.height * s,
  }
}

type CanvasToolbarProps = {
  onAdd: (kind: ElementKind) => void
}

function CanvasToolbar({ onAdd }: CanvasToolbarProps) {
  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-[1100] flex -translate-x-1/2 gap-2 rounded-lg border border-neutral-200 bg-white/90 p-2 shadow-md backdrop-blur-sm">
      <button
        type="button"
        className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-200"
        onClick={() => onAdd('note')}
      >
        + Note
      </button>
      <button
        type="button"
        className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-200"
        onClick={() => onAdd('task')}
      >
        + Task
      </button>
      <button
        type="button"
        className="rounded-md bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-200"
        onClick={() => onAdd('card')}
      >
        + Card
      </button>
    </div>
  )
}

function rectStrokeProps(
  el: CanvasElement,
  selected: boolean,
): { stroke: string; strokeWidth: number } | Record<string, never> {
  if (selected) {
    return { stroke: '#3b82f6', strokeWidth: 2 }
  }
  if (el.kind === 'card') {
    return { stroke: '#d4d4d8', strokeWidth: 2 }
  }
  return {}
}

type CanvasElementNodeProps = {
  el: CanvasElement
  selected: boolean
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  onEditRequest: (el: CanvasElement) => void
}

function CanvasElementNode({
  el,
  selected,
  onSelect,
  onDragEnd,
  onEditRequest,
}: CanvasElementNodeProps) {
  const strokeProps = rectStrokeProps(el, selected)

  return (
    <Group
      x={el.x}
      y={el.y}
      draggable
      onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.evt.button !== 0) return
        e.cancelBubble = true
        onSelect(el.id)
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
        width={el.width}
        height={el.height}
        fill={el.color}
        cornerRadius={4}
        {...strokeProps}
      />
      <Text
        x={8}
        y={8}
        width={el.width - 16}
        height={el.height - 16}
        text={el.text}
        fontSize={14}
        fill="#171717"
        wrap="word"
        verticalAlign="top"
      />
    </Group>
  )
}

export function Canvas({ initialState }: { initialState: CanvasState }) {
  const { state, commit, undo, redo } = useCanvasHistory(initialState)
  const stateRef = useRef(state)

  const stageRef = useRef<Konva.Stage>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [containerRect, setContainerRect] = useState<DOMRectReadOnly | null>(
    null,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const effectiveSelectedId = useMemo(() => {
    if (selectedId === null) return null
    return state.elements.some((e) => e.id === selectedId) ? selectedId : null
  }, [selectedId, state.elements])

  const effectiveSelectedIdRef = useRef<string | null>(null)
  useLayoutEffect(() => {
    effectiveSelectedIdRef.current = effectiveSelectedId
  }, [effectiveSelectedId])

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
    const sync = () => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
      setContainerRect(el.getBoundingClientRect())
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const spaceDown = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = true
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
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
  }, [undo, redo])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (effectiveSelectedIdRef.current === null) return
      const active = document.activeElement?.tagName
      if (active === 'INPUT' || active === 'TEXTAREA') return
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      e.preventDefault()
      const id = effectiveSelectedIdRef.current
      setSelectedId(null)
      commit((d) => {
        d.elements = d.elements.filter((x) => x.id !== id)
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit])

  const panning = useRef(false)
  const panStart = useRef({ cx: 0, cy: 0, vx: 0, vy: 0 })
  const [panDraft, setPanDraft] = useState<{ x: number; y: number } | null>(
    null,
  )

  const vx = panDraft?.x ?? state.viewport.x
  const vy = panDraft?.y ?? state.viewport.y
  const vScale = state.viewport.scale

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

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage()
    if (!stage) return
    const name = e.target.name()
    const canPan =
      name === 'folium-bg' &&
      (e.evt.button === 1 || (e.evt.button === 0 && spaceDown.current))
    if (!canPan) return
    e.evt.preventDefault()
    panning.current = true
    panStart.current = {
      cx: e.evt.clientX,
      cy: e.evt.clientY,
      vx: state.viewport.x,
      vy: state.viewport.y,
    }
    setPanDraft({ x: state.viewport.x, y: state.viewport.y })
  }

  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!panning.current) return
    const { cx, cy, vx: ox, vy: oy } = panStart.current
    const dx = e.evt.clientX - cx
    const dy = e.evt.clientY - cy
    setPanDraft({ x: ox + dx, y: oy + dy })
  }

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

  const addAtCenter = (kind: ElementKind) => {
    const stage = stageRef.current
    if (!stage) return
    const cx = size.w / 2
    const cy = size.h / 2
    const wx = (cx - vx) / vScale
    const wy = (cy - vy) / vScale
    const next = createElement(kind, wx, wy)
    commit((d) => {
      d.elements.push(next)
    })
  }

  const onBgDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target.name() !== 'folium-bg') return
    const stage = e.target.getStage()
    if (!stage) return
    const w = worldFromPointer(stage, { x: vx, y: vy, scale: vScale })
    if (!w) return
    const next = createElement('note', w.wx, w.wy)
    commit((d) => {
      d.elements.push(next)
    })
  }

  const onDragEnd = (id: string, x: number, y: number) => {
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

  const editLayout = useMemo(() => {
    if (!editing || !containerRect) return null
    return screenRectForElementInContainer(containerRect, editing, {
      x: vx,
      y: vy,
      scale: vScale,
    })
  }, [editing, containerRect, vx, vy, vScale])

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

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full bg-neutral-100"
      style={{ touchAction: 'none' }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={vx}
        y={vy}
        scaleX={vScale}
        scaleY={vScale}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMouseMove}
        onWheel={onWheel}
      >
        <Layer listening>
          <Rect
            name="folium-bg"
            x={-1e6}
            y={-1e6}
            width={2e6}
            height={2e6}
            fill="#f5f5f5"
            listening
            onClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              if (e.target.name() !== 'folium-bg') return
              if (e.evt.button !== 0) return
              setSelectedId(null)
            }}
            onDblClick={onBgDblClick}
          />
          {state.elements.map((el) => (
            <CanvasElementNode
              key={el.id}
              el={el}
              selected={el.id === effectiveSelectedId}
              onSelect={setSelectedId}
              onDragEnd={onDragEnd}
              onEditRequest={onEditRequest}
            />
          ))}
        </Layer>
      </Stage>

      {editLayout ? (
        <textarea
          className="pointer-events-auto fixed z-[1200] resize-none rounded border border-neutral-300 bg-white p-1 text-sm text-neutral-900 shadow-lg outline-none focus:ring-2 focus:ring-neutral-400"
          style={{
            left: editLayout.left,
            top: editLayout.top,
            width: editLayout.width,
            height: editLayout.height,
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

      <CanvasToolbar onAdd={addAtCenter} />
    </div>
  )
}
