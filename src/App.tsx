import { useEffect, useState } from 'react'
import { Tldraw, type TLEditorSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { subscribeCanvasPersistence } from './canvasPersistence'
import { loadCanvasRow } from './db'
import { FoliumTopBar } from './FoliumTopBar'
import { SaveStatusProvider } from './SaveStatusContext'

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: TLEditorSnapshot | undefined }

function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const row = await loadCanvasRow()
        if (cancelled) return
        setBoot({
          status: 'ready',
          snapshot: row?.snapshot,
        })
      } catch {
        if (cancelled) return
        setBoot({ status: 'ready', snapshot: undefined })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SaveStatusProvider>
      <FoliumTopBar />
      {boot.status === 'loading' ? (
        <div className="folium-boot" aria-hidden />
      ) : (
        <div className="folium-canvas">
          <Tldraw
            inferDarkMode
            snapshot={boot.snapshot}
            onMount={(editor) => subscribeCanvasPersistence(editor)}
          />
        </div>
      )}
    </SaveStatusProvider>
  )
}

export default App
