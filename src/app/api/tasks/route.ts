// List recent tasks for the live tracker UI.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshTaskFromProvider } from '@/lib/task-worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 200)
  const status = url.searchParams.get('status')

  // On-demand refresh of active tasks (throttled per task inside the helper)
  // so progress keeps moving on serverless where background workers die.
  try {
    const active = await db.task.findMany({
      where: { status: { in: ['queued', 'running'] } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true },
    })
    await Promise.all(active.map((t) => refreshTaskFromProvider(t.id).catch(() => {})))
  } catch {
    // refresh is best-effort — never block listing
  }

  const where = status ? { status } : {}
  const tasks = await db.task.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    tasks: tasks.map((t) => ({
      task_id: t.id,
      type: t.type,
      status: t.status,
      progress: t.progress,
      params: safeParse(t.params),
      result: t.result ? safeParse(t.result) : null,
      error: t.error,
      usedKeyLabel: t.usedKeyLabel,
      attempts: t.attempts,
      durationMs: t.durationMs,
      created_at: new Date(t.createdAt).toISOString(),
      started_at: t.startedAt ? new Date(t.startedAt).toISOString() : null,
      completed_at: t.completedAt ? new Date(t.completedAt).toISOString() : null,
      updated_at: new Date(t.updatedAt).toISOString(),
    })),
  })
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
