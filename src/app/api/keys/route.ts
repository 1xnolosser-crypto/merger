// REST API for managing API keys (used by the web UI).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const keys = await db.apiKey.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  // Never expose the actual key value to the browser; mask it.
  const safe = keys.map((k) => ({
    id: k.id,
    label: k.label,
    masked: maskKey(k.keyValue),
    sortOrder: k.sortOrder,
    status: k.status,
    lastError: k.lastError,
    lastErrorAt: k.lastErrorAt ? new Date(k.lastErrorAt).toISOString() : null,
    lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt).toISOString() : null,
    successCount: k.successCount,
    failCount: k.failCount,
    createdAt: new Date(k.createdAt).toISOString(),
  }))
  return NextResponse.json({ keys: safe })
  */
}

function maskKey(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

export async function POST(req: Request) {
  return NextResponse.json(
    { error: 'تم تعطيل تخزين مفاتيح KIE لأن التوليد المدفوع محظور بسياسة التكلفة الصفرية.' },
    { status: 403 },
  )
  /* Legacy key creation is intentionally unreachable while paid providers are disabled.
  let body: { keyValue?: string; label?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const keyValue = (body.keyValue || '').trim()
  const label = (body.label || 'Unnamed').trim()
  if (!keyValue) {
    return NextResponse.json({ error: 'keyValue is required' }, { status: 400 })
  }

  const max = await db.apiKey.aggregate({ _max: { sortOrder: true } })
  const nextSort = (max._max.sortOrder || 0) + 1

  try {
    const created = await db.apiKey.create({
      data: { keyValue, label, sortOrder: nextSort, status: 'active' },
    })
    return NextResponse.json({
      ok: true,
      key: {
        id: created.id,
        label: created.label,
        masked: maskKey(created.keyValue),
        sortOrder: created.sortOrder,
        status: created.status,
      },
    })
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('Unique')) {
      return NextResponse.json({ error: 'هذا المفتاح موجود بالفعل' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
