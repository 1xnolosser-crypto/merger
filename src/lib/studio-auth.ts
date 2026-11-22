import { timingSafeEqual } from 'crypto'

/** Shared-secret gate for the local Windows worker and studio job API. */
export function isAuthorizedStudioRequest(req: Request): boolean {
  const expected = process.env.STUDIO_WORKER_TOKEN
  if (!expected || expected.length < 32) return false
  const header = req.headers.get('authorization') || ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!supplied || supplied.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  } catch {
    return false
  }
}
