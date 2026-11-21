// MCP Streamable HTTP endpoint.
// Mounted at /mcp — clients POST JSON-RPC requests here, GET for SSE streams,
// DELETE to end a session. Per MCP spec, this is the only MCP URL.
// Stateless + JSON mode — see src/lib/mcp-server.ts.

import { handleMcpRequest } from '@/lib/mcp-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Long enough for `after()` workers to poll provider tasks in the background
// (merge re-encodes + video generation); on-demand refresh covers the rest.
export const maxDuration = 300

export async function POST(req: Request) {
  return handleMcpRequest(req)
}

export async function GET(req: Request) {
  return handleMcpRequest(req)
}

export async function DELETE(req: Request) {
  return handleMcpRequest(req)
}
