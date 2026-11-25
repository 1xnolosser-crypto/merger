// MCP server with 5 tools, exposed over Streamable HTTP at /mcp.
//
// Stateless mode: every request gets a fresh McpServer + transport pair with
// JSON responses. This is intentional for serverless deployment (Vercel):
//   - no session state to lose between function invocations
//   - JSON bodies instead of long-lived SSE streams (which serverless
//     functions cannot keep open between requests)
// Standard MCP clients (ChatGPT, Claude, Cursor, ...) send initialize →
// notifications/initialized → tools/list → tools/call and work unchanged.
//
// The 5 tools:
//   1. generate_image     — disabled to prevent paid API calls
//   2. generate_video     — disabled; use the local free video studio instead
//   3. merge_videos       — ordered merge of N video URLs into one
//   4. get_task           — poll a task by task_id
//   5. list_recent_tasks  — last 20 tasks for context recovery

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { db } from './db'
import { createTask, refreshTaskFromProvider } from './task-worker'
import type { PublicTask } from './types'

const SERVER_NAME = 'mcp-media-gen'
const SERVER_VERSION = '1.1.0'

// ─── Tool definitions ───────────────────────────────────────────────────────

function registerTools(server: McpServer): void {
  server.tool(
    'generate_image',
    'Image generation is currently blocked by the zero-cost safety policy; no paid provider request will be sent. ' +
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
    async () => toolText({
      status: 'disabled',
      error: 'التوليد السحابي للصور معطّل لضمان عدم استهلاك أي رصيد أو الاتصال بمزود مدفوع.',
      alternative: 'استخدم صور Wikimedia Commons ذات الرخصة القابلة لإعادة الاستخدام ضمن scripts/run-free-video.ps1.',
    }, true),
  )

  server.tool(
    'generate_video',
    'Video generation is currently blocked by the zero-cost safety policy; no paid provider request will be sent. ' +
      'A genuinely free local or free-tier provider must be integrated before this tool can generate media.',
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
    async () => toolText({
      status: 'disabled',
      error: 'التوليد السحابي للفيديو معطّل نهائيًا في المسار المجاني؛ لن يتم الاتصال بـAgnes أو KIE أو أي مزود توليد.',
      alternative: 'أنشئ الفيديو محليًا عبر Wikimedia Commons + Edge TTS + FFmpeg باستخدام scripts/run-free-video.ps1.',
    }, true),
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
      // On-demand refresh: ask the provider for fresh state and persist it,
      // so the task keeps moving even when the background worker was killed
      // by a serverless timeout.
      await refreshTaskFromProvider(args.task_id).catch(() => {})

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

// ─── Request handling (stateless) ───────────────────────────────────────────

export async function handleMcpRequest(req: Request): Promise<Response> {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, logging: {} } },
  )
  registerTools(server)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no Mcp-Session-Id handshake
    enableJsonResponse: true, // single JSON body instead of an SSE stream
  })
  await server.connect(transport)
  return transport.handleRequest(req)
}
