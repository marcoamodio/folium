/* Context modules conventionally export a hook alongside the provider. */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { registerSaveStatusNotifier, type SaveStatus } from './saveStatus'

export type { SaveStatus }

export type SaveStatusContextValue = {
  status: SaveStatus
  /** Increments on every successful save so consumers can reset UI (e.g. fade timer). */
  savedNonce: number
}

const SaveStatusContext = createContext<SaveStatusContextValue | null>(null)

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedNonce, setSavedNonce] = useState(0)

  useEffect(() => {
    registerSaveStatusNotifier((next) => {
      setStatus(next)
      if (next === 'saved') {
        setSavedNonce((n) => n + 1)
      }
    })
    return () => {
      registerSaveStatusNotifier(null)
    }
  }, [])

  const value = useMemo(
    () => ({ status, savedNonce }),
    [status, savedNonce],
  )

  return (
    <SaveStatusContext.Provider value={value}>
      {children}
    </SaveStatusContext.Provider>
  )
}

export function useSaveStatus(): SaveStatusContextValue {
  const ctx = useContext(SaveStatusContext)
  if (!ctx) {
    throw new Error('useSaveStatus must be used within SaveStatusProvider')
  }
  return ctx
}
