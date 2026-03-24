import { useEffect, useState } from 'react'
import { Canvas } from './Canvas'
import { decrypt } from './crypto'
import { getOrCreateKey } from './cryptoKey'
import { loadCanvasRow } from './db'
import { FoliumTopBar } from './FoliumTopBar'
import { SaveStatusProvider } from './SaveStatusContext'
import { DEFAULT_STATE, parseCanvasStateJson, type CanvasState } from './types'

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; canvasState: CanvasState }

function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await getOrCreateKey()
        const row = await loadCanvasRow()
        if (cancelled) return

        if (!row?.payload) {
          setBoot({ status: 'ready', canvasState: DEFAULT_STATE })
          return
        }

        const key = await getOrCreateKey()
        const plaintext = await decrypt(row.payload, key)
        const canvasState = parseCanvasStateJson(plaintext)
        if (cancelled) return
        setBoot({ status: 'ready', canvasState })
      } catch {
        console.warn(
          'Folium: could not decrypt or parse stored canvas; starting with an empty document.',
        )
        if (!cancelled) {
          setBoot({ status: 'ready', canvasState: DEFAULT_STATE })
        }
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
          <Canvas initialState={boot.canvasState} />
        </div>
      )}
    </SaveStatusProvider>
  )
}

export default App
