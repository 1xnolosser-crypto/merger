// Agnes AI video client.
// This client intentionally uses ONLY the currently promoted free Flash model.
// It never falls back to paid video models or another provider.
import type { GenerateVideoParams } from './types'

export const AGNES_VIDEO_MODEL = 'agnes-video-2.5-flash'
const AGNES_API_ROOT = 'https://apihub.agnes-ai.com'

export interface AgnesVideoInfo {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  resultUrl?: string
  error?: string
  videoId?: string
}

function safeProviderError(status: number): string {
  // Preserve only the numeric HTTP status for internal task logs.
  // Never log response bodies, prompts, authorization headers, or API keys.
  return `AGNES_HTTP_${status}`
}

function parseStatus(value: unknown): AgnesVideoInfo['status'] {
  const s = String(value ?? '').toLowerCase()
  if (['completed', 'complete', 'success', 'succeeded', 'done'].includes(s)) return 'completed'
  if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed'
  if (['processing', 'running', 'in_progress', 'in-progress'].includes(s)) return 'processing'
  return 'pending'
}

function findUrl(obj: any): string | undefined {
  const candidates = [obj?.url, obj?.video_url, obj?.result_url, obj?.output_url,
    obj?.data?.url, obj?.data?.video_url, obj?.result?.url, obj?.output?.url]
  return candidates.find((v) => typeof v === 'string' && /^https?:\\/\\//i.test(v))
}

function normalizeInfo(payload: any): AgnesVideoInfo {
  const status = parseStatus(payload?.status ?? payload?.data?.status ?? payload?.state)
  return {
    status,
    progress: Number.isFinite(Number(payload?.progress ?? payload?.data?.progress))
      ? Number(payload?.progress ?? payload?.data?.progress) : undefined,
    resultUrl: findUrl(payload),
    error: status === 'failed' ? 'AGNES_VIDEO_FAILED' : undefined,
    videoId: payload?.video_id ?? payload?.data?.video_id ?? payload?.id,
  }
}

async function requestJson(url: string, apiKey: string, init?: RequestInit): Promise<any> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new Error('AGNES_NETWORK_ERROR')
  }
  if (!response.ok) {
    const status = response.status
    // Safe diagnostic: numeric status only. Never log body, prompt, or credentials.
    console.error(`[agnes] provider HTTP status=${status}`)
    await response.text().catch(() => '')
    throw new Error(safeProviderError(status))
  }
  try {
    return await response.json()
  } catch {
    throw new Error('AGNES_INVALID_RESPONSE')
  }
}

/**
 * Retry ONLY confirmed 503 queue rejections. Keep this short so serverless
 * workers don't spend minutes waiting while the free queue is unavailable.
 * Never retry network errors/timeouts/other statuses (ambiguous acceptance).
 * At most 2 retries (5s and 15s). Free Agnes only; no paid fallback.
 */
async function submitWithQueueBackoff(apiKey: string, payload: Record<string, string>): Promise<any> {
  const delaysMs = [5_000, 15_000]
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestJson(`${AGNES_API_ROOT}/v1/videos`, apiKey, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch (error) {
      const message = (error as Error).message
      if (message !== 'AGNES_HTTP_503' || attempt >= delaysMs.length) throw error
      const delay = delaysMs[attempt]
      console.warn(`[agnes] free queue busy (503); retry ${attempt + 1}/2 after ${delay / 1000}s`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

export async function createAgnesVideo(apiKey: string, params: GenerateVideoParams): Promise<string> {
  if (!apiKey.trim()) throw new Error('NO_AGNES_API_KEY')
  const seconds = Math.round(params.duration ?? 8)
  if (seconds < 4 || seconds > 12) throw new Error('AGNES_DURATION_UNSUPPORTED')
  const aspectRatio = params.aspectRatio ?? '9:16'
  if (!['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(aspectRatio)) {
    throw new Error('AGNES_ASPECT_UNSUPPORTED')
  }

  const payload = {
    model: AGNES_VIDEO_MODEL,
    prompt: params.prompt,
    mode: 'text',
    seconds: String(seconds),
    size: '720P',
    aspect_ratio: aspectRatio,
  }
  const result = await submitWithQueueBackoff(apiKey, payload)
  const id = result?.video_id ?? result?.data?.video_id ?? result?.task_id ?? result?.id
  if (typeof id !== 'string' || !id.trim()) throw new Error('AGNES_NO_VIDEO_ID')
  return id
}

/** Poll using video_id + model_name as documented by Agnes. */
export async function getAgnesVideoInfo(apiKey: string, videoId: string): Promise<AgnesVideoInfo> {
  if (!apiKey.trim()) throw new Error('NO_AGNES_API_KEY')
  const url = new URL(`${AGNES_API_ROOT}/agnesapi`)
  url.searchParams.set('video_id', videoId)
  url.searchParams.set('model_name', AGNES_VIDEO_MODEL)
  const payload = await requestJson(url.toString(), apiKey, { method: 'GET' })
  return normalizeInfo(payload)
}
