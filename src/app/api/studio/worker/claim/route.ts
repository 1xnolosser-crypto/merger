import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAuthorizedStudioRequest } from '@/lib/studio-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!isAuthorizedStudioRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const candidate = await db.task.findFirst({
    where: { type: 'studio_render', status: 'queued' },
    orderBy: { createdAt: 'asc' },
  })
  if (!candidate) return NextResponse.json({ job: null })

  // Compare-and-set prevents two local workers from claiming the same job.
  const claimed = await db.task.updateMany({
    where: { id: candidate.id, type: 'studio_render', status: 'queued' },
    data: { status: 'running', progress: 5, startedAt: new Date(), updatedAt: new Date() },
  })
  if (claimed.count !== 1) return NextResponse.json({ job: null })

  await db.taskLog.create({
    data: { taskId: candidate.id, level: 'info', message: 'Claimed by local Windows worker.', internal: false },
  })
  return NextResponse.json({
    job: { task_id: candidate.id, params: JSON.parse(candidate.params) },
  })
}
