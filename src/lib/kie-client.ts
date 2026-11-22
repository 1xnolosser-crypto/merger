// Thin kie.ai REST client.
// All generation requests go through POST /api/v1/jobs/createTask and
// status polling goes through GET /api/v1/jobs/recordInfo?taskId=...
//
// The client NEVER sees API keys directly — the caller passes the key to use.

import { KIE_BASE_URL } from './types'

export interface CreateTaskArgs {
  apiKey: string
  model: string
  input: Record<string, unknown>
  callBackUrl?: string
}

export interface CreateTaskResponse {
  code: number
  msg: string
  data: { taskId: string } | null
}

export interface RecordInfoResponse {
  code: number
  msg: string
  data:
    | {
        taskId: string
        // kie.ai uses "state" not "status". Values seen: 'queuing' | 'processing' | 'success' | 'failed'
        state?: string
        status?: string
        progress?: number
        // resultJson is a string-encoded JSON like {"resultUrls":["https://..."],"usage":{...}}
        resultJson?: string | null
        // result is sometimes present (older format)
        result?: string | string[] | { url?: string } | null
        resultUrl?: string | null
        error?: string | null
        failMsg?: string | null
        failCode?: string | number | null
        failed?: boolean
        successFlag?: number
        output?: { url?: string } | null
      }
    | null
}

export class KieApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly kieCode?: number,
    public readonly isQuota: boolean = false,
    public readonly isInvalidKey: boolean = false,
    public readonly isRetriable: boolean = false,
  ) {
    super(message)
    this.name = 'KieApiError'
  }
}

function classifyStatus(
  httpStatus: number,
  kieCode: number | undefined,
  msg: string,
): {
  isQuota: boolean
  isInvalidKey: boolean
  isRetriable: boolean
} {
  const lower = (msg || '').toLowerCase()
  // 402 Payment Required — out of credits
  const isQuota =
    httpStatus === 402 ||
    kieCode === 402 ||
    lower.includes('insufficient') ||
    lower.includes('credit') ||
    lower.includes('quota') ||
    lower.includes('balance')
  // 401/403 — bad token
  const isInvalidKey =
    httpStatus === 401 ||
    httpStatus === 403 ||
    kieCode === 401 ||
    kieCode === 403 ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid token')
  // 429, 5xx, network — try next key
  const isRetriable =
    httpStatus === 429 ||
    httpStatus === 500 ||
    httpStatus === 502 ||
    httpStatus === 503 ||
    httpStatus === 504 ||
    (httpStatus >= 500 && httpStatus < 600)
  return { isQuota, isInvalidKey, isRetriable }
}

export async function createTask({
  apiKey,
  model,
  input,
  callBackUrl,
}: CreateTaskArgs): Promise<string> {
  const body: Record<string, unknown> = { model, input }
  if (callBackUrl) body.callBackUrl = callBackUrl

  let res: Response
  try {
    res = await fetch(`${KIE_BASE_URL}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    // Network error — retriable
    throw new KieApiError(
      `network error reaching kie.ai: ${(e as Error).message}`,
      0,
      undefined,
      false,
      false,
      true,
    )
  }

  let json: CreateTaskResponse | null = null
  try {
    json = (await res.json()) as CreateTaskResponse
  } catch {
    // Non-JSON response — retriable
    throw new KieApiError(
      `kie.ai returned non-JSON (HTTP ${res.status})`,
      res.status,
      undefined,
      false,
      false,
      true,
    )
  }

  const httpStatus = res.status
  const kieCode = json?.code
  const msg = json?.msg || ''
  const cls = classifyStatus(httpStatus, kieCode, msg)

  if (!res.ok || !json?.data?.taskId) {
    throw new KieApiError(
      `kie.ai createTask failed: HTTP ${httpStatus} code=${kieCode} msg="${msg}"`,
      httpStatus,
      kieCode,
      cls.isQuota,
      cls.isInvalidKey,
      cls.isRetriable,
    )
  }

  return json.data.taskId
}

export interface RecordInfoResult {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number // 0..100
  resultUrl: string | null
  error: string | null
}

function extractUrl(data: NonNullable<RecordInfoResponse['data']>): string | null {
  // 1) Modern path: resultJson is a string-encoded JSON with { resultUrls: [...] }
  if (typeof data.resultJson === 'string' && data.resultJson.length > 0) {
    try {
      const parsed = JSON.parse(data.resultJson)
      if (Array.isArray(parsed?.resultUrls) && parsed.resultUrls.length > 0) {
        return String(parsed.resultUrls[0])
      }
      if (typeof parsed?.url === 'string') return parsed.url
      if (typeof parsed?.result === 'string') return parsed.result
    } catch {
      // resultJson wasn't valid JSON
    }
  }
  // 2) Older formats
  if (typeof data.result === 'string') return data.result
  if (Array.isArray(data.result) && data.result.length > 0) {
    const first = data.result[0]
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && typeof first.url === 'string') {
      return first.url
    }
  }
  if (data.result && typeof data.result === 'object' && typeof data.result.url === 'string') {
    return data.result.url
  }
  if (typeof data.resultUrl === 'string') return data.resultUrl
  if (data.output && typeof data.output.url === 'string') return data.output.url
  return null
}

function normalizeState(raw: string | undefined): RecordInfoResult['status'] {
  if (!raw) return 'pending'
  const s = raw.toLowerCase()
  if (s === 'success' || s === 'completed' || s === 'complete' || s === 'succeeded') return 'completed'
  if (s === 'failed' || s === 'fail' || s === 'error') return 'failed'
  if (s === 'processing' || s === 'running' || s === 'in_progress' || s === 'queued' || s === 'queuing' || s === 'pending') return 'processing'
  return 'pending'
}

export async function getTaskInfo(
  apiKey: string,
  taskId: string,
): Promise<RecordInfoResult> {
  let res: Response
  try {
    res = await fetch(
      `${KIE_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    )
  } catch (e) {
    throw new KieApiError(
      `network error polling task: ${(e as Error).message}`,
      0,
      undefined,
      false,
      false,
      true,
    )
  }

  if (res.status === 404) {
    // Task vanished — treat as failed
    return {
      status: 'failed',
      progress: 0,
      resultUrl: null,
      error: 'task not found at provider',
    }
  }

  let json: RecordInfoResponse | null = null
  try {
    json = (await res.json()) as RecordInfoResponse
  } catch {
    throw new KieApiError(
      `kie.ai returned non-JSON for recordInfo (HTTP ${res.status})`,
      res.status,
      undefined,
      false,
      false,
      true,
    )
  }

  const data = json?.data
  if (!data) {
    const cls = classifyStatus(res.status, json?.code, json?.msg || '')
    throw new KieApiError(
      `kie.ai recordInfo failed: HTTP ${res.status} code=${json?.code} msg="${json?.msg}"`,
      res.status,
      json?.code,
      cls.isQuota,
      cls.isInvalidKey,
      cls.isRetriable,
    )
  }

  const status = normalizeState(data.state || data.status || undefined)
  const progress = typeof data.progress === 'number' ? data.progress : 0
  const resultUrl = extractUrl(data)
  const error =
    data.error ||
    data.failMsg ||
    (data.failed ? 'task failed at provider' : null) ||
    (data.successFlag === 0 ? 'task failed (successFlag=0)' : null) ||
    null

  return { status, progress, resultUrl, error }
}
