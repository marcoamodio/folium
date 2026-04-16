import { useEffect, useState } from 'react'
import { Canvas } from './Canvas'
import { decrypt } from './crypto'
import { getOrCreateKey } from './cryptoKey'
import { loadCanvasRow } from './db'
import { FoliumTopBar } from './FoliumTopBar'
import { MobileCourtesy } from './MobileCourtesy'
import { SaveStatusProvider } from './SaveStatusContext'
import {
  DEFAULT_STATE,
  parseCanvasStateJson,
  type CanvasState,
  type CanvasStateParseCorruption,
} from './types'
import { useIsPhoneViewport } from './useIsPhoneViewport'

type BootState =
  | { status: 'loading' }
  | {
      status: 'ready'
      canvasState: CanvasState
      parseCorruption: CanvasStateParseCorruption | null
    }

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
          setBoot({
            status: 'ready',
            canvasState: DEFAULT_STATE,
            parseCorruption: null,
          })
          return
        }

        const key = await getOrCreateKey()
        const plaintext = await decrypt(row.payload, key)
        const { state, corruption } = parseCanvasStateJson(plaintext)
        if (cancelled) return
        setBoot({
          status: 'ready',
          canvasState: state,
          parseCorruption: corruption,
        })
      } catch {
        if (import.meta.env.DEV) {
          console.warn(
            'Folium: could not decrypt or parse stored canvas; starting with an empty document.',
          )
        }
        if (!cancelled) {
          setBoot({
            status: 'ready',
            canvasState: DEFAULT_STATE,
            parseCorruption: null,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const parseBanner =
    boot.status === 'ready' && boot.parseCorruption ? (
      <div
        role="alert"
        className="folium-parse-warning"
        style={{
          position: 'fixed',
          top: 48,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 2000,
          maxWidth: 'min(92vw, 480px)',
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(254, 243, 199, 0.96)',
          border: '1px solid rgba(217, 119, 6, 0.35)',
          color: '#78350f',
          fontSize: 13,
          lineHeight: 1.45,
          boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
        }}
      >
        {boot.parseCorruption === 'invalid_json'
          ? 'Saved data was damaged or incomplete. The canvas was reset to a blank document.'
          : 'Some saved content could not be restored safely. The canvas was reset to a blank document.'}
      </div>
    ) : null

  return (
    <SaveStatusProvider>
      <FoliumTopBar presenting={presenting} />
      {parseBanner}
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
