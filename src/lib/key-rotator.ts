// Zero-cost safety guard for media generation.
// Paid KIE generation is deliberately disabled. No API key is read, selected,
// rotated, or sent to an external generation provider from this module.

import type { ApiKey } from '@prisma/client'

export interface RotationResult<T> {
  data: T
  usedKey: ApiKey
  attempts: 0
  trace: RotationTraceEntry[]
}

export interface RotationTraceEntry {
  keyId: string
  keyLabel: string
  outcome: 'success' | 'quota' | 'invalid' | 'retriable' | 'network'
  message: string
}

/**
 * Fail closed: the previous implementation silently rotated through KIE keys,
 * including after quota/credit errors. This project requires zero paid usage.
 * Keep the existing signature for callers, but do not make any network request.
 */
export async function withKeyRotation<T>(
  _fn: (key: ApiKey) => Promise<T>,
): Promise<RotationResult<T>> {
  throw new Error('PAID_PROVIDER_DISABLED: KIE generation is blocked by the zero-cost policy.')
}
