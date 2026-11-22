// Update / delete a single API key.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: {
    label?: string
    status?: 'active' | 'exhausted' | 'invalid' | 'paused'
    sortOrder?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (typeof body.label === 'string') data.label = body.label
  if (typeof body.status === 'string') data.status = body.status
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder

  try {
    const updated = await db.apiKey.update({ where: { id }, data })
    return NextResponse.json({ ok: true, status: updated.status })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    await db.apiKey.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
