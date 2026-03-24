import { encrypt } from './crypto'
import { getOrCreateKey } from './cryptoKey'
import { CANVAS_ID, db } from './db'
import { notifySaveStatus } from './saveStatus'

const DEBOUNCE_MS = 400

const keyPromise = getOrCreateKey()

export type CanvasPersistenceBinding = {
  serialize: () => string
  subscribe: (onChange: () => void) => () => void
}

export function subscribeCanvasPersistence(
  binding: CanvasPersistenceBinding,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  async function runSave(): Promise<void> {
    notifySaveStatus('saving')

    let json: string
    try {
      json = binding.serialize()
    } catch {
      notifySaveStatus('idle')
      return
    }

    try {
      const key = await keyPromise
      const payload = await encrypt(json, key)
      await db.canvas.put({
        id: CANVAS_ID,
        payload,
        updatedAt: Date.now(),
      })
      if (timer !== null) return
      notifySaveStatus('saved')
    } catch {
      if (timer !== null) return
      notifySaveStatus('error')
    }
  }

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    void runSave()
  }

  const schedule = () => {
    notifySaveStatus('saving')
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void runSave()
    }, DEBOUNCE_MS)
  }

  const unlisten = binding.subscribe(schedule)

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush()
  }

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flush)

  return () => {
    unlisten()
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', flush)
    flush()
  }
}
