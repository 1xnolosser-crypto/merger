import { NextResponse } from 'next/server'
import { retryWaitingAgnesTask } from '@/lib/task-worker'

export const runtime = 'nodejs'
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = req.headers.get('authorization')
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const scheduled = await retryWaitingAgnesTask()
    return NextResponse.json({ ok: true, scheduled })
  } catch (error) {
    console.error('[agnes-cron] retry failed:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
