import { useEffect, useState } from 'react'
import { Canvas } from './Canvas'
import { decrypt } from './crypto'
import { getOrCreateKey } from './cryptoKey'
import { loadCanvasRow } from './db'
import { FoliumTopBar } from './FoliumTopBar'
import { MobileCourtesy } from './MobileCourtesy'
import { SaveStatusProvider } from './SaveStatusContext'
import { DEFAULT_STATE, parseCanvasStateJson, type CanvasState } from './types'
import { useIsPhoneViewport } from './useIsPhoneViewport'

type BootState =
  | { status: 'loading' }
  | { status: 'ready'; canvasState: CanvasState }

function AppDesktop() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' })
  const [presenting, setPresenting] = useState(false)

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
      <FoliumTopBar presenting={presenting} />
      {boot.status === 'loading' ? (
        <div className="folium-boot" aria-hidden />
      ) : (
        <div className="folium-canvas">
          <Canvas
            initialState={boot.canvasState}
            presenting={presenting}
            onPresentingChange={setPresenting}
          />
        </div>
      )}
      <footer
        className={`folium-app-credit${presenting ? ' folium-app-credit--presenting-dim' : ''}`}
        aria-label="Version and copyright"
      >
        <p className="folium-app-credit__tagline">
          Folium v0.1 · All data stays on your device
        </p>
        <p className="folium-app-credit__owner">© 2026 Marco Amodio</p>
      </footer>
    </SaveStatusProvider>
  )
}

function App() {
  const isPhoneViewport = useIsPhoneViewport()
  if (isPhoneViewport) return <MobileCourtesy />
  return <AppDesktop />
}

export default App
