// MCP server with 5 tools, exposed over Streamable HTTP at /mcp.
//
// Each MCP client connection (ChatGPT, Claude, Cursor, ...) gets its own
// session: a dedicated McpServer + WebStandardStreamableHTTPServerTransport
// pair, keyed by sessionId.
//
// The 5 tools:
//   1. generate_image     — text → image via gpt-image-2-6/flare-text-to-image
//   2. generate_video     — text → video (native audio) via grok-imagine-video-1-5-preview
//   3. merge_videos       — ordered merge of N video URLs into one
//   4. get_task           — poll a task by task_id
//   5. list_recent_tasks  — last 20 tasks for context recovery

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { db } from './db'
import { createTask } from './task-worker'
import type { PublicTask } from './types'

const SERVER_NAME = 'mcp-media-gen'
const SERVER_VERSION = '1.0.0'

// ─── Tool definitions ───────────────────────────────────────────────────────
// Defined once and registered on every new session.

function registerTools(server: McpServer): void {
  server.tool(
    'generate_image',
    'Generate an image from a text prompt. Model: gpt-image-2-6/flare-text-to-image. ' +
      'Returns a task_id immediately; poll with get_task every ~10s until status=succeeded.',
    {
      prompt: z.string().min(1).describe('The text prompt describing the image to generate.'),
      aspect_ratio: z
        .enum(['1:1', '16:9', '9:16', '4:3', '3:2', 'auto'])
        .optional()
        .describe('Aspect ratio. Defaults to "auto".'),
      resolution: z
        .enum(['1K', '2K', '4K'])
        .optional()
        .describe('Output resolution. Defaults to provider default.'),
    },
    async (args) => {
      const taskId = await createTask({
        type: 'image',
        params: {
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
        },
      })
      return toolText({
        task_id: taskId,
        status: 'queued',
        progress: 0,
        watch_hint: 'Poll get_task with this task_id every ~10 seconds until status="succeeded".',
      })
    },
  )

  server.tool(
    'generate_video',
    'Generate a video with native synchronized audio (dialogue/effects/music) from a text prompt. ' +
      'Model: grok-imagine-video-1-5-preview. Returns a task_id immediately; poll with get_task.',
    {
      prompt: z.string().min(1).describe('The text prompt describing the video to generate.'),
      aspect_ratio: z
        .enum(['16:9', '9:16', '1:1'])
        .optional()
        .describe('Aspect ratio. Defaults to "16:9".'),
      resolution: z
        .enum(['480p', '720p', '1080p'])
        .optional()
        .describe('Output resolution.'),
      duration: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Target duration in seconds (1-20). Provider may snap to nearest supported.'),
    },
    async (args) => {
      const taskId = await createTask({
        type: 'video',
        params: {
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
          duration: args.duration,
        },
      })
      return toolText({
        task_id: taskId,
        status: 'queued',
        progress: 0,
        watch_hint: 'Poll get_task with this task_id every ~10 seconds until status="succeeded".',
      })
    },
  )

  server.tool(
    'merge_videos',
    'Merge multiple videos (by URL) into a single high-quality video in the requested order. ' +
      'All source URLs must be publicly accessible. The merged video is uploaded to a public ' +
      'file host and its URL returned via get_task.',
    {
      urls: z
        .array(z.string().url())
        .min(2)
        .max(20)
        .describe('Ordered list of source video URLs. Order = output order.'),
      name: z
        .string()
        .optional()
        .describe('Optional output filename (without extension).'),
    },
    async (args) => {
      const taskId = await createTask({
        type: 'merge',
        params: { urls: args.urls, name: args.name },
      })
      return toolText({
        task_id: taskId,
        status: 'queued',
        progress: 0,
        watch_hint: 'Poll get_task with this task_id every ~10 seconds until status="succeeded".',
      })
    },
  )

  server.tool(
    'get_task',
    'Get the current status of a task by task_id. Returns status (queued|running|succeeded|failed), ' +
      'progress (0-100), result_url when ready, and error message if failed. ' +
      'Recommended polling interval: ~10 seconds.',
    {
      task_id: z
        .string()
        .min(1)
        .describe('The task_id returned by generate_image/generate_video/merge_videos.'),
    },
    async (args) => {
      const task = await db.task.findUnique({ where: { id: args.task_id } })
      if (!task) {
        return toolText(
          {
            task_id: args.task_id,
            status: 'not_found',
            error: 'task_id not found',
          },
          true,
        )
      }
      const publicTask: PublicTask = {
        task_id: task.id,
        type: task.type as PublicTask['type'],
        status: task.status as PublicTask['status'],
        progress: task.progress,
        result_url: task.result ? JSON.parse(task.result).url : undefined,
        error: task.error || undefined,
        created_at: new Date(task.createdAt).toISOString(),
        updated_at: new Date(task.updatedAt).toISOString(),
        completed_at: task.completedAt ? new Date(task.completedAt).toISOString() : undefined,
      }
      return toolText(publicTask)
    },
  )

  server.tool(
    'list_recent_tasks',
    'List the 20 most recent tasks (any status) for context recovery after a restart. ' +
      'Returns minimal fields per task; use get_task for full details.',
    {},
    async () => {
      const tasks = await db.task.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          type: true,
          status: true,
          progress: true,
          createdAt: true,
          completedAt: true,
        },
      })
      return toolText({
        tasks: tasks.map((t) => ({
          task_id: t.id,
          type: t.type,
          status: t.status,
          progress: t.progress,
          created_at: new Date(t.createdAt).toISOString(),
          completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null,
        })),
      })
    },
  )
}

function toolText(obj: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
    ...(isError ? { isError: true } : {}),
  }
}

// ─── Per-session server management ──────────────────────────────────────────

interface SessionEntry {
  server: McpServer
  transport: WebStandardStreamableHTTPServerTransport
  initialized: Promise<void>
  lastSeen: number
}

const globalForMcp = globalThis as unknown as {
  __mcpSessions?: Map<string, SessionEntry>
}

function sessions(): Map<string, SessionEntry> {
  if (!globalForMcp.__mcpSessions) {
    globalForMcp.__mcpSessions = new Map()
  }
  return globalForMcp.__mcpSessions
}

// How long to keep an idle session before garbage collecting it.
const SESSION_TTL_MS = 30 * 60 * 1000

function gcSessions() {
  const now = Date.now()
  for (const [id, entry] of sessions()) {
    if (now - entry.lastSeen > SESSION_TTL_MS) {
      entry.server.close().catch(() => {})
      sessions().delete(id)
    }
  }
}

function isInitializeRequest(req: Request): boolean {
  // Cheap check: look at the body for method: "initialize"
  // We can't read the body here without consuming it, so we clone.
  return req.method === 'POST'
}

async function isInitializeBody(req: Request): Promise<boolean> {
  if (req.method !== 'POST') return false
  try {
    const cloned = req.clone()
    const body = await cloned.json()
    if (Array.isArray(body)) {
      return body.some((m) => m?.method === 'initialize')
    }
    return body?.method === 'initialize'
  } catch {
    return false
  }
}

export async function handleMcpRequest(req: Request): Promise<Response> {
  gcSessions()

  // For an initialize POST, spin up a new session.
  if (await isInitializeBody(req)) {
    const sessionId = randomUUID()
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: false,
    })
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { capabilities: { tools: {}, logging: {} } },
    )
    registerTools(server)
    const initialized = server.connect(transport)
    sessions().set(sessionId, {
      server,
      transport,
      initialized,
      lastSeen: Date.now(),
    })
    await initialized
    return transport.handleRequest(req)
  }

  // For subsequent requests, route to the right session by header.
  const sessionId = req.headers.get('mcp-session-id') || ''
  const entry = sessionId ? sessions().get(sessionId) : undefined
  if (entry) {
    entry.lastSeen = Date.now()
    await entry.initialized
    return entry.transport.handleRequest(req)
  }

  // No valid session — let the transport emit a clean 400.
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: no valid session. Send an initialize request first.' },
      id: null,
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}
