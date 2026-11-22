// REST API for viewing legacy KIE keys. Paid key creation is disabled.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const keys = await db.apiKey.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
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
}

function maskKey(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

export async function POST() {
  return NextResponse.json(
    { error: 'تم تعطيل تخزين مفاتيح KIE لأن التوليد المدفوع محظور بسياسة التكلفة الصفرية.' },
    { status: 403 },
  )
}
