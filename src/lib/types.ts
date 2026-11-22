// Shared types for the MCP media-generation server.

export type TaskType = 'image' | 'video' | 'merge'

export type TaskStatus =
  | 'queued'      // accepted, not yet started
  | 'running'     // a worker is actively processing
  | 'succeeded'   // completed with a result URL
  | 'failed'      // exhausted all keys / unrecoverable error

export type ApiKeyStatus =
  | 'active'     // healthy, will be tried
  | 'exhausted'  // quota depleted (402/429 from kie.ai)
  | 'invalid'    // bad token (401/403)
  | 'paused'     // manually disabled from the UI

export interface GenerateImageParams {
  prompt: string
  /** Optional: '1:1' | '16:9' | '9:16' | '4:3' | '3:2' | 'auto' */
  aspectRatio?: string
  /** Optional: '1K' | '2K' | '4K' */
  resolution?: string
}

export interface GenerateVideoParams {
  prompt: string
  /** Optional: '16:9' | '9:16' | '1:1' */
  aspectRatio?: string
  /** Optional: '480p' | '720p' | '1080p' */
  resolution?: string
  /** Optional seconds (3-10 typical) */
  duration?: number
}

export interface MergeVideosParams {
  /** Ordered list of source video URLs. */
  urls: string[]
  /** Optional output filename (without extension). */
  name?: string
}

export type TaskParams =
  | GenerateImageParams
  | GenerateVideoParams
  | MergeVideosParams

export interface TaskResult {
  /** Public URL of the generated/merged media. */
  url: string
  /** Optional secondary outputs (e.g. thumbnail). */
  extra?: Record<string, string>
  /** Original task id returned by kie.ai (for image/video). */
  providerTaskId?: string
  /** Duration in seconds (for videos). */
  durationSeconds?: number
  /** Size in bytes if known. */
  sizeBytes?: number
}

export interface PublicTask {
  task_id: string
  type: TaskType
  status: TaskStatus
  progress: number
  result_url?: string
  error?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface KeyRotationOutcome {
  ok: boolean
  usedKeyLabel?: string
  attempts: number
  /** Sanitized error message safe to expose (never includes key values). */
  publicError?: string
}

export const KIE_BASE_URL = 'https://api.kie.ai'

export const IMAGE_MODEL = 'gpt-image-2-6/flare-text-to-image'
export const VIDEO_MODEL = 'grok-imagine-video-1-5-preview'
