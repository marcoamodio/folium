import { useEffect, useRef, useState } from 'react'
import landingBackground from './assets/background.webp'
import { Canvas } from './Canvas'
import { LandingPage } from './components/LandingPage'
import { decrypt } from './crypto'
import { getOrCreateKey } from './cryptoKey'
import { loadCanvasRow, type CanvasRow } from './db'
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
      hasSavedCanvas: boolean
    }

function AppDesktop() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' })
  const [presenting, setPresenting] = useState(false)
  const [landingFadeOut, setLandingFadeOut] = useState(false)
  const [landingDismissed, setLandingDismissed] = useState(false)
  const landingOpenTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  )

  useEffect(() => {
    return () => {
      if (landingOpenTimeoutRef.current !== null) {
        window.clearTimeout(landingOpenTimeoutRef.current)
        landingOpenTimeoutRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let rowAtFailure: CanvasRow | undefined
    ;(async () => {
      try {
        await getOrCreateKey()
        const row = await loadCanvasRow()
        rowAtFailure = row
        if (cancelled) return

        const hasSavedCanvas = Boolean(row?.payload)
        if (!hasSavedCanvas) {
          setBoot({
            status: 'ready',
            canvasState: DEFAULT_STATE,
            parseCorruption: null,
            hasSavedCanvas: false,
          })
          return
        }

        const key = await getOrCreateKey()
        const plaintext = await decrypt(row!.payload, key)
        const { state, corruption } = parseCanvasStateJson(plaintext)
        if (cancelled) return
        setBoot({
          status: 'ready',
          canvasState: state,
          parseCorruption: corruption,
          hasSavedCanvas: true,
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
            hasSavedCanvas: Boolean(rowAtFailure?.payload),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const showLanding =
    boot.status === 'ready' && !boot.hasSavedCanvas && !landingDismissed

  const showAppChrome =
    boot.status === 'ready' && (boot.hasSavedCanvas || landingDismissed)

  const handleLandingOpen = () => {
    setLandingFadeOut(true)
    landingOpenTimeoutRef.current = window.setTimeout(() => {
      landingOpenTimeoutRef.current = null
      setLandingDismissed(true)
      setLandingFadeOut(false)
    }, 300)
  }

  const parseBanner =
    showAppChrome &&
    boot.status === 'ready' &&
    boot.parseCorruption ? (
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
      {boot.status === 'loading' ? (
        <div
          className="folium-boot"
          aria-hidden
          style={{
            backgroundImage: `url(${landingBackground})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center right',
            backgroundRepeat: 'no-repeat',
          }}
        />
      ) : null}

      {showAppChrome ? (
        <>
          <FoliumTopBar presenting={presenting} />
          {parseBanner}
          <div className="folium-canvas">
            <Canvas
              initialState={boot.canvasState}
              presenting={presenting}
              onPresentingChange={setPresenting}
            />
          </div>
          <footer
            className={`folium-app-credit${presenting ? ' folium-app-credit--presenting-dim' : ''}`}
            aria-label="Version and copyright"
          >
            <p className="folium-app-credit__tagline">
              Folium v0.1 · All data stays on your device
            </p>
            <p className="folium-app-credit__owner">© 2026 Marco Amodio</p>
          </footer>
        </>
      ) : null}

      {showLanding ? (
        <LandingPage
          fadeOut={landingFadeOut}
          onRequestOpen={handleLandingOpen}
        />
      ) : null}
    </SaveStatusProvider>
  )
}

function App() {
  const isPhoneViewport = useIsPhoneViewport()
  if (isPhoneViewport) return <MobileCourtesy />
  return <AppDesktop />
}

export default App
