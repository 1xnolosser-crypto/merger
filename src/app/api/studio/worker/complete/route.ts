import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAuthorizedStudioRequest } from '@/lib/studio-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!isAuthorizedStudioRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let body: { task_id?: string; status?: 'succeeded' | 'failed'; local_path?: string; error?: string; duration_seconds?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof body.task_id !== 'string' || !body.task_id.startsWith('studio_')) {
    return NextResponse.json({ error: 'Invalid task_id.' }, { status: 400 })
  }
  if (body.status !== 'succeeded' && body.status !== 'failed') {
    return NextResponse.json({ error: 'status must be succeeded or failed.' }, { status: 400 })
  }
  if (body.status === 'succeeded' && (typeof body.local_path !== 'string' || body.local_path.length > 500)) {
    return NextResponse.json({ error: 'local_path is required for successful renders.' }, { status: 400 })
  }

  const task = await db.task.findUnique({ where: { id: body.task_id } })
  if (!task || task.type !== 'studio_render') {
    return NextResponse.json({ error: 'Studio job not found.' }, { status: 404 })
  }
  if (task.status !== 'running') {
    return NextResponse.json({ error: 'Studio job is not running.' }, { status: 409 })
  }

  const now = new Date()
  const result = body.status === 'succeeded'
    ? { local_path: body.local_path, delivery: 'saved-on-worker-computer' }
    : null
  const error = body.status === 'failed'
    ? (typeof body.error === 'string' ? body.error.slice(0, 500) : 'Local render failed.')
    : null

  await db.task.update({
    where: { id: body.task_id },
    data: {
      status: body.status,
      progress: body.status === 'succeeded' ? 100 : task.progress,
      result: result ? JSON.stringify(result) : null,
      error,
      completedAt: now,
      updatedAt: now,
      durationMs: task.startedAt ? now.getTime() - new Date(task.startedAt).getTime() : null,
    },
  })
  await db.taskLog.create({
    data: {
      taskId: body.task_id,
      level: body.status === 'succeeded' ? 'info' : 'error',
      message: body.status === 'succeeded' ? `Local render saved: ${body.local_path}` : error || 'Local render failed.',
      internal: false,
    },
  })
  return NextResponse.json({ ok: true, task_id: body.task_id, status: body.status })
}
