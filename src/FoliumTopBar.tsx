import { useEffect, useState } from 'react'
import { useSaveStatus } from './SaveStatusContext'
import type { SaveStatus } from './saveStatus'

function FoliumMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={18}
      height={18}
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M9 15.5V9"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        fill="currentColor"
        d="M9 2.25c.35 0 .7.06 1.03.17 2.9.95 4.47 4.02 3.52 6.92a5.65 5.65 0 0 1-2.09 2.93A5.4 5.4 0 0 1 9 13.25a5.4 5.4 0 0 1-2.46-.98 5.65 5.65 0 0 1-2.09-2.93c-.95-2.9.62-5.97 3.52-6.92.33-.11.68-.17 1.03-.17Z"
      />
    </svg>
  )
}

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
      <span className="folium-top-bar__saved-dot" />
      <span className="folium-top-bar__saved-label">{STATUS_LABEL[status]}</span>
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
        <div className="folium-top-bar__brand">
          <FoliumMark className="folium-top-bar__mark" />
          <span className="folium-top-bar__title">Folium</span>
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
