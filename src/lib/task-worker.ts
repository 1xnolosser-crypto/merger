// Background task worker.
//
// Lifecycle:
//   1. createTask() writes a Task row with status="queued" and returns its id.
//   2. runTask() is invoked async (NOT awaited) — the MCP tool returns immediately.
//   3. runTask() iterates keys via withKeyRotation, talks to kie.ai (for image/video)
//      or to the merge service (for merge), updates progress, and on success marks
//      the task "succeeded" with the result URL.
//   4. On any unrecoverable failure (all keys failed), the task is marked "failed"
//      with a sanitized message — the AI never sees key-level details.
//
// Progress events are also emitted to the WebSocket mini-service via emitProgress().

import { db } from './db'
import { withKeyRotation, type RotationTraceEntry } from './key-rotator'
import { createTask as kieCreateTask, getTaskInfo, KieApiError } from './kie-client'
import { mergeVideos } from './merge-service'
import {
  IMAGE_MODEL,
  VIDEO_MODEL,
  type GenerateImageParams,
  type GenerateVideoParams,
  type MergeVideosParams,
  type TaskParams,
  type TaskResult,
  type TaskType,
} from './types'
import { randomUUID } from 'crypto'
import { emitProgress } from './ws-bus'
import { after } from 'next/server'

const POLL_INTERVAL_MS = 4000
const MAX_POLL_DURATION_MS = 7 * 60 * 1000 // 7 minutes per attempt

// On-demand refresh throttles & staleness thresholds (serverless mode):
//   - never hit the provider more than once per REFRESH_MIN_INTERVAL_MS
//   - tasks that never reached the provider (or merge jobs) die after these
const REFRESH_MIN_INTERVAL_MS = 5000
const UNSUBMITTED_STALE_MS = 3 * 60 * 1000
const MERGE_STALE_MS = 8 * 60 * 1000
const PROVIDER_MAX_AGE_MS = 10 * 60 * 1000

function newTaskId(): string {
  return `task_${randomUUID().replace(/-/g, '').slice(0, 24)}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function log(
  taskId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string,
  internal = false,
) {
  await db.taskLog
    .create({
      data: { taskId, level, message: message.slice(0, 1000), internal },
    })
    .catch(() => {})
}

async function setProgress(taskId: string, progress: number, status?: string) {
  await db.task
    .update({
      where: { id: taskId },
      data: {
        progress: Math.max(0, Math.min(100, progress)),
        ...(status ? { status } : {}),
        updatedAt: new Date(),
      },
    })
    .catch(() => {})
  emitProgress(taskId, progress, status || '')
}

export interface CreateTaskInput {
  type: TaskType
  params: TaskParams
}

export async function createTask(input: CreateTaskInput): Promise<string> {
  const id = newTaskId()
  await db.task.create({
    data: {
      id,
      type: input.type,
      status: 'queued',
      params: JSON.stringify(input.params),
      progress: 0,
    },
  })
  await log(id, 'info', `Task created: type=${input.type}`, false)
  scheduleTaskRun(id, input.type, input.params)
  return id
}

/**
 * Start the task worker AFTER the HTTP response has been sent.
 *
 * On long-lived servers this is equivalent to fire-and-forget. On serverless
 * platforms (Vercel) fire-and-forget work is killed as soon as the response
 * returns — `after()` keeps the invocation alive so the worker can run up to
 * the function's maxDuration. If `after()` is unavailable (called outside a
 * request scope, e.g. from a script), we fall back to plain fire-and-forget.
 */
export function scheduleTaskRun(taskId: string, type: TaskType, params: TaskParams): void {
  try {
    after(() => runTask(taskId, type, params))
  } catch {
    runTask(taskId, type, params).catch((e) => {
      console.error(`[worker] uncaught for ${taskId}:`, e)
    })
  }
}

async function runTask(
  taskId: string,
  type: TaskType,
  params: TaskParams,
): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: { status: 'running', startedAt: new Date(), updatedAt: new Date() },
  })
  await setProgress(taskId, 5, 'running')
  await log(taskId, 'info', 'Worker started')

  const startedAt = Date.now()
  try {
    let result: TaskResult
    if (type === 'image') {
      result = await runImageOrVideo(taskId, 'image', params as GenerateImageParams)
    } else if (type === 'video') {
      result = await runImageOrVideo(taskId, 'video', params as GenerateVideoParams)
    } else if (type === 'merge') {
      result = await runMerge(taskId, params as MergeVideosParams)
    } else {
      throw new Error(`unknown task type: ${type}`)
    }

    const durationMs = Date.now() - startedAt
    await db.task.update({
      where: { id: taskId },
      data: {
        status: 'succeeded',
        progress: 100,
        result: JSON.stringify(result),
        completedAt: new Date(),
        updatedAt: new Date(),
        durationMs,
      },
    })
    await setProgress(taskId, 100, 'succeeded')
    await log(taskId, 'info', `Task succeeded in ${durationMs}ms; url=${result.url}`)
  } catch (e) {
    const durationMs = Date.now() - startedAt
    const err = e as Error & { trace?: RotationTraceEntry[] }

    // Sanitize: never expose key values, key ids, or kie.ai internal codes.
    const publicMsg = publicTaskError(err.message)

    await db.task.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: publicMsg,
        completedAt: new Date(),
        updatedAt: new Date(),
        durationMs,
      },
    })
    await setProgress(taskId, 0, 'failed')
    await log(taskId, 'error', `Task failed: ${err.message}; trace=${JSON.stringify(err.trace || [])}`, true)
  }
}

async function runImageOrVideo(
  taskId: string,
  kind: 'image' | 'video',
  params: GenerateImageParams | GenerateVideoParams,
): Promise<TaskResult> {
  const model = kind === 'image' ? IMAGE_MODEL : VIDEO_MODEL
  const input: Record<string, unknown> = { prompt: params.prompt }
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio
  if ('resolution' in params && params.resolution) input.resolution = params.resolution
  if ('duration' in params && params.duration) input.duration = params.duration

  // Step 1: submit task to kie.ai via key rotation
  await setProgress(taskId, 15)
  const submitResult = await withKeyRotation(async (key) => {
    await log(
      taskId,
      'info',
      `Submitting to kie.ai with key="${key.label}" model=${model}`,
      true,
    )
    const providerTaskId = await kieCreateTask({ apiKey: key.keyValue, model, input })
    return { providerTaskId, keyLabel: key.label }
  })

  // Persist the provider coordinates so an on-demand refresher (MCP get_task,
  // /api/tasks polling) can keep the task moving even if this worker dies
  // (serverless timeout, redeploy, cold start) before completion.
  await db.task.update({
    where: { id: taskId },
    data: {
      usedKeyLabel: submitResult.usedKey.label,
      attempts: submitResult.attempts,
      providerTaskId: submitResult.data.providerTaskId,
      providerKeyLabel: submitResult.usedKey.label,
      providerCheckedAt: new Date(),
    },
  })
  await setProgress(taskId, 30)
  await log(
    taskId,
    'info',
    `Submitted to kie.ai providerTaskId=${submitResult.data.providerTaskId} via key="${submitResult.usedKey.label}"`,
    true,
  )

  // Step 2: poll for completion using the SAME key that submitted successfully
  // (kie.ai returns the same task result regardless of which key polls,
  //  but we use the submitting key for consistency).
  const pollingKey = submitResult.usedKey
  const startTs = Date.now()
  let lastProgress = 30
  while (true) {
    if (Date.now() - startTs > MAX_POLL_DURATION_MS) {
      throw new Error('POLL_TIMEOUT')
    }
    await sleep(POLL_INTERVAL_MS)

    let info
    try {
      info = await getTaskInfo(pollingKey.keyValue, submitResult.data.providerTaskId)
    } catch (e) {
      // Polling error — log and continue if retriable
      if (e instanceof KieApiError && e.isRetriable) {
        await log(taskId, 'warn', `Polling retriable error: ${e.message}`, true)
        continue
      }
      // Non-retriable polling error — give up
      throw e
    }

    // Remember when we last talked to the provider (refresh throttle).
    await db.task
      .update({ where: { id: taskId }, data: { providerCheckedAt: new Date() } })
      .catch(() => {})

    if (info.status === 'completed' && info.resultUrl) {
      // Push a final progress update if provider didn't reach 100
      const finalProgress = Math.max(info.progress || 0, 100)
      await setProgress(taskId, finalProgress)
      return {
        url: info.resultUrl,
        providerTaskId: submitResult.data.providerTaskId,
      }
    }
    if (info.status === 'failed') {
      throw new Error(`PROVIDER_FAILED: ${info.error || 'unknown'}`)
    }
    // Still pending/processing
    const scaled = 30 + Math.round(((info.progress || 0) / 100) * 65)
    if (scaled !== lastProgress) {
      await setProgress(taskId, scaled)
      lastProgress = scaled
    }
  }
}

async function runMerge(taskId: string, params: MergeVideosParams): Promise<TaskResult> {
  if (!params.urls || params.urls.length < 2) {
    throw new Error('NEED_AT_LEAST_TWO_VIDEOS')
  }
  const result = await mergeVideos({
    urls: params.urls,
    outName: params.name,
    onProgress: async (p) => {
      await setProgress(taskId, p.progress)
      if (p.message) {
        await log(taskId, 'info', p.message).catch(() => {})
      }
    },
  })
  return {
    url: result.url,
    sizeBytes: result.sizeBytes,
    durationSeconds: result.durationSeconds,
  }
}

// Periodic cleanup: mark stale "running" tasks (server crashed mid-task) as failed.
// Called from a setInterval in the mini-service.
export async function recoverStaleTasks() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000)
  const stale = await db.task.findMany({
    where: {
      status: { in: ['queued', 'running'] },
      updatedAt: { lt: cutoff },
    },
    take: 50,
  })
  for (const t of stale) {
    await db.task.update({
      where: { id: t.id },
      data: {
        status: 'failed',
        error: 'انتهت المهلة دون اكتمال المهمة.',
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    await log(t.id, 'warn', 'Recovered as failed (stale > 30m)', true)
  }
}

/**
 * Map an internal error to a sanitized, user-facing Arabic message.
 * Shared by the worker and the on-demand refresher so both surfaces stay
 * consistent. Never includes key values, key ids, or provider internals.
 */
export function publicTaskError(errMsg: string): string {
  if (errMsg.startsWith('PAID_PROVIDER_DISABLED')) {
    return 'تم إيقاف التوليد السحابي المدفوع لحماية رصيدك. لم يتم إرسال طلب توليد أو استهلاك أي رصيد. يلزم ربط مولّد مجاني فعلي قبل تفعيل هذه الوظيفة.'
  }
  if (errMsg === 'NO_ACTIVE_KEYS') {
    return 'لا توجد مفاتيح API نشطة. أضف مفتاحًا من لوحة الإدارة.'
  }
  if (errMsg === 'NO_INPUT_URLS' || errMsg === 'NEED_AT_LEAST_TWO_VIDEOS') {
    return 'يجب تمرير رابطي فيديو على الأقل للدمج.'
  }
  if (errMsg === 'ALL_KEYS_FAILED') {
    return 'تعذّر إتمام الطلب بعد تجربة كل المفاتيح المتاحة.'
  }
  if (errMsg.startsWith('ffmpeg') || errMsg.startsWith('ffprobe')) {
    return 'حدث خطأ أثناء معالجة الفيديو. تحقّق من الروابط وحاول مجددًا.'
  }
  if (errMsg.startsWith('download failed')) {
    return 'تعذّر تنزيل أحد المقاطع. تحقّق من الروابط.'
  }
  if (errMsg.startsWith('upload') || errMsg.startsWith('page fetch')) {
    return 'تعذّر رفع النتيجة إلى خدمة الاستضافة. حاول لاحقًا.'
  }
  if (errMsg === 'POLL_TIMEOUT') {
    return 'انتهت المهلة أثناء انتظار نتيجة المزود. حاول مجددًا.'
  }
  if (errMsg.startsWith('PROVIDER_FAILED')) {
    return 'رفض المزود إتمام الطلب. عدّل الوصف وحاول مجددًا.'
  }
  return 'فشلت كل المحاولات. راجع لوحة المفاتيح في الواجهة.'
}

// ─── On-demand refresh (serverless safety net) ─────────────────────────────

/**
 * Ask kie.ai for fresh state of a task and persist it.
 *
 * Called from every read surface (MCP get_task, GET /api/tasks/:id,
 * GET /api/tasks) so tasks keep progressing even when the background worker
 * was killed by a serverless timeout. Throttled to one provider call per
 * REFRESH_MIN_INTERVAL_MS. Returns the (possibly updated) task row or null.
 */
export async function refreshTaskFromProvider(taskId: string): Promise<unknown> {
  const task = await db.task.findUnique({ where: { id: taskId } }).catch(() => null)
  if (!task) return null
  if (task.status === 'succeeded' || task.status === 'failed') return task

  const updatedAtAge = Date.now() - new Date(task.updatedAt).getTime()

  // Merge tasks run fully in-process (download → ffmpeg → upload) — nothing to
  // ask a provider. If the worker died mid-merge, the task is unrecoverable.
  if (task.type === 'merge') {
    if (updatedAtAge > MERGE_STALE_MS) {
      return await markTaskFailed(
        task.id,
        'انتهت مهلة معالجة الدمج. قد تكون المقاطع كبيرة جدًا — جرّب مقاطع أقصر أو أقل.',
      )
    }
    return task
  }

  // Image/video without a provider task id: the worker never reached kie.ai.
  if (!task.providerTaskId) {
    if (updatedAtAge > UNSUBMITTED_STALE_MS) {
      return await markTaskFailed(
        task.id,
        'تعذّر بدء المعالجة عند المزود. تحقق من المفاتيح النشطة وحاول مجددًا.',
      )
    }
    return task
  }

  // Image/video with a provider task id — throttled provider refresh.
  const checkedAge = task.providerCheckedAt
    ? Date.now() - new Date(task.providerCheckedAt).getTime()
    : Infinity
  if (checkedAge < REFRESH_MIN_INTERVAL_MS) return task
  if (Date.now() - new Date(task.createdAt).getTime() > PROVIDER_MAX_AGE_MS) {
    return await markTaskFailed(task.id, publicTaskError('POLL_TIMEOUT'))
  }

  // The key that submitted the task is the one that may poll it.
  const key = task.providerKeyLabel
    ? await db.apiKey.findFirst({ where: { label: task.providerKeyLabel } })
    : null
  if (!key) {
    await log(task.id, 'warn', `refresh: key "${task.providerKeyLabel}" not found`, true)
    return task
  }

  let info
  try {
    info = await getTaskInfo(key.keyValue, task.providerTaskId)
  } catch (e) {
    await log(
      task.id,
      'warn',
      `refresh: provider error ${(e as Error).message.slice(0, 160)}`,
      true,
    )
    await db.task
      .update({ where: { id: task.id }, data: { providerCheckedAt: new Date() } })
      .catch(() => {})
    return task
  }

  await db.task
    .update({ where: { id: task.id }, data: { providerCheckedAt: new Date() } })
    .catch(() => {})

  if (info.status === 'failed') {
    return await markTaskFailed(
      task.id,
      publicTaskError(`PROVIDER_FAILED: ${info.error || 'unknown'}`),
    )
  }

  if (info.status === 'completed' && info.resultUrl) {
    const result: TaskResult = {
      url: info.resultUrl,
      providerTaskId: task.providerTaskId,
    }
    const completedAt = new Date()
    const startedAt = task.startedAt
      ? new Date(task.startedAt).getTime()
      : new Date(task.createdAt).getTime()
    const updated = await db.task
      .update({
        where: { id: task.id },
        data: {
          status: 'succeeded',
          progress: 100,
          result: JSON.stringify(result),
          completedAt,
          updatedAt: completedAt,
          durationMs: Math.max(0, completedAt.getTime() - startedAt),
        },
      })
      .catch(() => task)
    emitProgress(task.id, 100, 'succeeded')
    await log(task.id, 'info', `refresh: completed via on-demand poll; url=${info.resultUrl}`).catch(
      () => {},
    )
    return updated
  }

  // Still pending/processing — mirror the worker's 30..95 scaling.
  const scaled = 30 + Math.round(((info.progress || 0) / 100) * 65)
  if (scaled !== task.progress) {
    await setProgress(task.id, scaled)
  }
  return await db.task.findUnique({ where: { id: task.id } }).catch(() => task)
}

async function markTaskFailed(taskId: string, publicMsg: string) {
  const updated = await db.task
    .update({
      where: { id: taskId },
      data: {
        status: 'failed',
        error: publicMsg,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .catch(() => null)
  emitProgress(taskId, 0, 'failed')
  await log(taskId, 'warn', `refresh: marked failed — ${publicMsg}`, true).catch(() => {})
  return updated
}
