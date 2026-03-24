import { produce, type Draft } from 'immer'
import { useCallback, useReducer } from 'react'
import type { CanvasState } from './types'

const MAX_SNAPSHOTS = 50

type HistoryModel = {
  past: CanvasState[]
  future: CanvasState[]
}

type HistoryAction =
  | { type: 'commit'; recipe: (draft: Draft<CanvasState>) => void }
  | { type: 'undo' }
  | { type: 'redo' }

function cloneState(s: CanvasState): CanvasState {
  return structuredClone(s)
}

function historyReducer(
  state: HistoryModel,
  action: HistoryAction,
): HistoryModel {
  switch (action.type) {
    case 'commit': {
      const current = state.past[state.past.length - 1]!
      const next = produce(current, action.recipe)
      let past = [...state.past, next]
      if (past.length > MAX_SNAPSHOTS) {
        past = past.slice(-MAX_SNAPSHOTS)
      }
      return { past, future: [] }
    }
    case 'undo': {
      if (state.past.length <= 1) return state
      const top = state.past[state.past.length - 1]!
      return {
        past: state.past.slice(0, -1),
        future: [top, ...state.future],
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const [head, ...ft] = state.future
      return {
        past: [...state.past, head!],
        future: ft,
      }
    }
    default:
      return state
  }
}

export function useCanvasHistory(initial: CanvasState) {
  const [model, dispatch] = useReducer(historyReducer, initial, (seed) => ({
    past: [cloneState(seed)],
    future: [],
  }))

  const state = model.past[model.past.length - 1]!

  const commit = useCallback(
    (recipe: (draft: Draft<CanvasState>) => void) => {
      dispatch({ type: 'commit', recipe })
    },
    [],
  )

  const undo = useCallback(() => {
    dispatch({ type: 'undo' })
  }, [])

  const redo = useCallback(() => {
    dispatch({ type: 'redo' })
  }, [])

  return { state, commit, undo, redo }
}
