import { useEffect, useState } from 'react'

const PHONE_MEDIA_QUERY = '(max-width: 767px)'

export function useIsPhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(PHONE_MEDIA_QUERY).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(PHONE_MEDIA_QUERY)
    const onChange = () => setIsPhone(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isPhone
}

