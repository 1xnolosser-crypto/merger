// Simple health endpoint.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'mcp-media-gen',
    time: new Date().toISOString(),
  })
}
