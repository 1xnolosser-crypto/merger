// Sequential API key rotator with automatic failover.
//
// CONTRACT (enforced by tests + this module):
//   - Keys are tried in ascending sortOrder, ALWAYS.
//   - On any failure (network/quota/invalid/retriable), the next key is tried
//     immediately WITHOUT stopping the task.
//   - The same task keeps its task_id; the AI model never sees key errors.
//   - Only the user-facing web UI sees which key was used and why others failed.
//
// "exhausted"  -> quota (402/429/credits)  — paused until manually re-enabled
// "invalid"    -> bad token (401/403)       — paused until manually re-enabled
//
// Other retriable errors (5xx, network) do NOT change the key's status — we
// just move on to the next key this turn, and the failed key stays "active"
// for future tasks.

import { db } from './db'
import type { ApiKey } from '@prisma/client'
import { KieApiError } from './kie-client'

export interface RotationResult<T> {
  data: T
  usedKey: ApiKey
  attempts: number
  /** Each attempt with its outcome. Length == attempts. */
  trace: RotationTraceEntry[]
}

export interface RotationTraceEntry {
  keyId: string
  keyLabel: string
  outcome: 'success' | 'quota' | 'invalid' | 'retriable' | 'network'
  message: string
}

export type KeyAction = 'mark-exhausted' | 'mark-invalid' | 'noop'

/**
 * Try each active key in order until `fn` returns a value.
 *
 * `fn` receives the chosen ApiKey and must either:
 *   - return a value (success — key is marked used + successCount++), or
 *   - throw a KieApiError (the rotator inspects flags and decides next step).
 *
 * Returns the value plus metadata about which key worked and the trace.
 */
export async function withKeyRotation<T>(
  fn: (key: ApiKey) => Promise<T>,
): Promise<RotationResult<T>> {
  const keys = await db.apiKey.findMany({
    where: { status: 'active' },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  if (keys.length === 0) {
    throw new Error('NO_ACTIVE_KEYS')
  }

  const trace: RotationTraceEntry[] = []
  let attempts = 0
  let lastErr: unknown = null

  for (const key of keys) {
    attempts += 1
    try {
      const data = await fn(key)

      // success — record usage
      await db.apiKey.update({
        where: { id: key.id },
        data: {
          lastUsedAt: new Date(),
          successCount: { increment: 1 },
          updatedAt: new Date(),
        },
      })

      trace.push({
        keyId: key.id,
        keyLabel: key.label,
        outcome: 'success',
        message: 'ok',
      })

      return { data, usedKey: key, attempts, trace }
    } catch (e) {
      lastErr = e

      if (e instanceof KieApiError) {
        let outcome: RotationTraceEntry['outcome']
        let action: KeyAction
        if (e.isQuota) {
          outcome = 'quota'
          action = 'mark-exhausted'
        } else if (e.isInvalidKey) {
          outcome = 'invalid'
          action = 'mark-invalid'
        } else if (e.isRetriable) {
          outcome = 'retriable'
          action = 'noop'
        } else {
          // Some other 4xx we don't recognize — treat as retriable (move to next key)
          outcome = 'retriable'
          action = 'noop'
        }

        trace.push({
          keyId: key.id,
          keyLabel: key.label,
          outcome,
          message: e.message.slice(0, 200),
        })

        await db.apiKey.update({
          where: { id: key.id },
          data: {
            failCount: { increment: 1 },
            lastError: e.message.slice(0, 280),
            lastErrorAt: new Date(),
            status: action === 'mark-exhausted' ? 'exhausted' :
                     action === 'mark-invalid'   ? 'invalid'    :
                     key.status,
            updatedAt: new Date(),
          },
        })

        // Continue to next key.
        continue
      } else {
        // Unknown error — record and continue.
        trace.push({
          keyId: key.id,
          keyLabel: key.label,
          outcome: 'network',
          message: (e as Error).message.slice(0, 200),
        })
        await db.apiKey.update({
          where: { id: key.id },
          data: {
            failCount: { increment: 1 },
            lastError: (e as Error).message.slice(0, 280),
            lastErrorAt: new Date(),
            updatedAt: new Date(),
          },
        })
        continue
      }
    }
  }

  // All keys failed.
  const err = new Error('ALL_KEYS_FAILED')
  ;(err as Error & { cause?: unknown }).cause = lastErr
  ;(err as Error & { trace?: RotationTraceEntry[] }).trace = trace
  throw err
}
