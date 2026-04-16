import { ExternalLink } from 'lucide-react'
import landingBackground from '../assets/background.webp'
import { APP_VERSION } from '../appMeta'

const GITHUB_REPO = 'https://github.com/marcoamodio/folium'
const LICENSE_URL = `${GITHUB_REPO}/blob/main/LICENSE`

type LandingPageProps = {
  fadeOut: boolean
  onRequestOpen: () => void
}

export function LandingPage({ fadeOut, onRequestOpen }: LandingPageProps) {
  return (
    <div
      className="folium-landing"
      style={{
        opacity: fadeOut ? 0 : 1,
        pointerEvents: fadeOut ? 'none' : 'auto',
        backgroundImage: `url(${landingBackground})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center right',
        backgroundRepeat: 'no-repeat',
      }}
      aria-hidden={fadeOut}
    >
      <header className="folium-landing__header">
        <img
          className="folium-landing__header-logo"
          src="/logo.svg"
          alt="Folium"
          draggable={false}
        />
        <nav className="folium-landing__nav" aria-label="Links">
          <a
            className="folium-landing__nav-link"
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
            <ExternalLink
              className="folium-landing__nav-link-icon"
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </a>
          <a
            className="folium-landing__nav-link"
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            License
            <ExternalLink
              className="folium-landing__nav-link-icon"
              size={14}
              strokeWidth={2}
              aria-hidden
            />
          </a>
        </nav>
      </header>

      <main className="folium-landing__main">
        <div className="folium-landing__hero">
          <p className="folium-landing__eyebrow">
            local-first canvas · v{APP_VERSION}
          </p>

          <h1 className="folium-landing__title">
            <span className="folium-landing__title-lead">Your canvas.</span>
            <span className="folium-landing__title-rest">
              <span className="folium-landing__title-line">Your device.</span>
              <span className="folium-landing__title-line">Your data.</span>
            </span>
          </h1>

          <p className="folium-landing__desc">
            An infinite canvas that runs entirely in your browser.
            <br />
            No accounts, no cloud, no tracking.
          </p>

          <button
            type="button"
            className="folium-landing__cta"
            onClick={onRequestOpen}
          >
            Open your canvas →
          </button>
        </div>
      </main>

      <footer className="folium-landing__footer">
        <div className="folium-landing__footer-inner">
          <p className="folium-landing__footer-line">
            Designed & built by Marco Amodio
          </p>
          <p className="folium-landing__footer-line">
            <a
              className="folium-landing__footer-link"
              href={GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="folium-landing__footer-link-text">Open source</span>
              <ExternalLink
                className="folium-landing__footer-link-icon"
                size={12}
                strokeWidth={2}
                aria-hidden
              />
            </a>
            <span className="folium-landing__footer-sep"> · </span>
            No account · No tracking · MIT License
          </p>
        </div>
      </footer>
    </div>
  )
}
