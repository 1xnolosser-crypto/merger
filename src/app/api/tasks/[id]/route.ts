// Get a single task by id (fallback when WS is unavailable).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshTaskFromProvider } from '@/lib/task-worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // On-demand provider refresh — keeps tasks moving on serverless.
  await refreshTaskFromProvider(id).catch(() => {})
  const t = await db.task.findUnique({ where: { id } })
  if (!t) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  return NextResponse.json({
    task_id: t.id,
    type: t.type,
    status: t.status,
    progress: t.progress,
    params: t.params ? JSON.parse(t.params) : null,
    result: t.result ? JSON.parse(t.result) : null,
    error: t.error,
    usedKeyLabel: t.usedKeyLabel,
    attempts: t.attempts,
    durationMs: t.durationMs,
    created_at: new Date(t.createdAt).toISOString(),
    started_at: t.startedAt ? new Date(t.startedAt).toISOString() : null,
    completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null,
    updated_at: new Date(t.updatedAt).toISOString(),
  })
}
