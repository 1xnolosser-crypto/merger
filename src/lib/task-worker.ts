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

const POLL_INTERVAL_MS = 4000
const MAX_POLL_DURATION_MS = 7 * 60 * 1000 // 7 minutes per attempt

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
  // Fire-and-forget the worker
  runTask(id, input.type, input.params).catch((e) => {
    console.error(`[worker] uncaught for ${id}:`, e)
  })
  return id
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
    let publicMsg = 'فشلت كل المحاولات. راجع لوحة المفاتيح في الواجهة.'
    if (err.message === 'NO_ACTIVE_KEYS') {
      publicMsg = 'لا توجد مفاتيح API نشطة. أضف مفتاحًا من لوحة الإدارة.'
    } else if (err.message === 'NO_INPUT_URLS' || err.message === 'NEED_AT_LEAST_TWO_VIDEOS') {
      publicMsg = 'يجب تمرير رابطي فيديو على الأقل للدمج.'
    } else if (err.message === 'ALL_KEYS_FAILED') {
      publicMsg = 'تعذّر إتمام الطلب بعد تجربة كل المفاتيح المتاحة.'
    } else if (err.message.startsWith('ffmpeg') || err.message.startsWith('ffprobe')) {
      publicMsg = 'حدث خطأ أثناء معالجة الفيديو. تحقّق من الروابط وحاول مجددًا.'
    } else if (err.message.startsWith('download failed')) {
      publicMsg = 'تعذّر تنزيل أحد المقاطع. تحقّق من الروابط.'
    } else if (err.message.startsWith('catbox') || err.message.startsWith('upload') || err.message.startsWith('page fetch')) {
      publicMsg = 'تعذّر رفع النتيجة إلى خدمة الاستضافة. حاول لاحقًا.'
    } else if (err.message === 'POLL_TIMEOUT') {
      publicMsg = 'انتهت المهلة أثناء انتظار نتيجة المزود. حاول مجددًا.'
    } else if (err.message.startsWith('PROVIDER_FAILED')) {
      publicMsg = 'رفض المزود إتمام الطلب. عدّل الوصف وحاول مجددًا.'
    }

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

  await db.task.update({
    where: { id: taskId },
    data: { usedKeyLabel: submitResult.usedKey.label, attempts: submitResult.attempts },
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
