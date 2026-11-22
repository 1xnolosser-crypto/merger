import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAuthorizedStudioRequest } from '@/lib/studio-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!isAuthorizedStudioRequest(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  let body: { task_id?: string; progress?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }) }
  if (typeof body.task_id !== 'string' || !body.task_id.startsWith('studio_')) return NextResponse.json({ error: 'Invalid task_id.' }, { status: 400 })
  if (!Number.isInteger(body.progress) || (body.progress as number) < 5 || (body.progress as number) > 99) return NextResponse.json({ error: 'progress must be 5..99.' }, { status: 400 })
  const updated = await db.task.updateMany({
    where: { id: body.task_id, type: 'studio_render', status: 'running' },
    data: { progress: body.progress, updatedAt: new Date() },
  })
  if (updated.count !== 1) return NextResponse.json({ error: 'Job is not running.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
