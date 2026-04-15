import { useEffect, useState } from 'react'
import { useSaveStatus } from './SaveStatusContext'
import type { SaveStatus } from './saveStatus'

const STATUS_LABEL: Record<Exclude<SaveStatus, 'idle'>, string> = {
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error saving',
}

type ActiveStatus = Exclude<SaveStatus, 'idle'>

function SaveStatusIndicator({ status }: { status: ActiveStatus }) {
  const [fadedOut, setFadedOut] = useState(false)

  useEffect(() => {
    if (status !== 'saved') return
    const t = window.setTimeout(() => setFadedOut(true), 3000)
    return () => window.clearTimeout(t)
  }, [status])

  const visible = status !== 'saved' || !fadedOut

  return (
    <span
      className="folium-top-bar__status-track"
      aria-hidden={!visible}
      data-visible={visible ? 'true' : 'false'}
    >
      {status === 'saved' ? (
        <span className="folium-top-bar__saved-emoji" aria-hidden="true">
          🎉
        </span>
      ) : (
        <span className="folium-top-bar__saved-dot" />
      )}
      <span className="folium-top-bar__saved-label">
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

export function FoliumTopBar() {
  const { status, savedNonce } = useSaveStatus()

  const indicatorKey =
    status === 'saved' ? `saved-${savedNonce}` : status

  return (
    <header className="folium-top-bar">
      <div className="folium-top-bar__inner">
        <div className="folium-top-bar__logo-wrap">
          <img
            className="folium-top-bar__logo"
            src="/logo.svg"
            alt="Folium"
            draggable={false}
          />
        </div>
        <div
          className={`folium-top-bar__status folium-top-bar__status--${status}`}
          aria-live="polite"
        >
          {status !== 'idle' ? (
            <SaveStatusIndicator key={indicatorKey} status={status} />
          ) : null}
        </div>
      </div>
    </header>
  )
}
