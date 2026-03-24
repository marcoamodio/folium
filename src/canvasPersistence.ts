import type { Editor, TLEditorSnapshot } from 'tldraw'
import { CANVAS_ID, db } from './db'
import { notifySaveStatus } from './saveStatus'

const DEBOUNCE_MS = 400

export function subscribeCanvasPersistence(editor: Editor): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  async function runSave(): Promise<void> {
    notifySaveStatus('saving')

    let snapshot: TLEditorSnapshot
    try {
      snapshot = editor.getSnapshot()
    } catch {
      notifySaveStatus('idle')
      return
    }

    try {
      await db.canvas.put({
        id: CANVAS_ID,
        snapshot,
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

  const unlisten = editor.store.listen(schedule)

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
