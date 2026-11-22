'use client'

import { useEffect, useState } from 'react'

/**
 * Stable placeholder shown on the server and on the first client render so
 * the hydration markup matches. Swapped to the real `window.location.origin`
 * after mount. Without this, `typeof window !== 'undefined' ? origin : ''`
 * produces different HTML on the server vs the client → hydration mismatch.
 */
const FALLBACK_ORIGIN = 'https://YOUR_DOMAIN'

export function useOrigin(): string {
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    }
  }, [])
  return origin
}
