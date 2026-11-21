// WebSocket mini-service for live task progress.
// Port: 3003 (defined here, NOT via env). Caddy forwards /?XTransformPort=3003
// to this port. Frontend uses io("/?XTransformPort=3003").
//
// Uses @libsql/client directly (no Prisma) to keep the mini-service
// self-contained.

import { createServer } from 'http'
import { Server } from 'socket.io'
import { createClient } from '@libsql/client'

const PORT = 3003

const url = process.env.DATABASE_URL
const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN
if (!url) {
  console.error('[ws-bus] DATABASE_URL not set')
  process.exit(1)
}
const db = createClient({ url, authToken })

interface Subscription {
  taskId: string
  lastProgress: number
  lastStatus: string
  timer: NodeJS.Timeout
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'ws-bus', port: PORT }))
    return
  }
  res.writeHead(404)
  res.end('Not Found')
})

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
})

const subscriptions = new Map<string, Subscription>() // socketId -> subscription

interface TaskRow {
  id: string
  type: string
  status: string
  progress: number
  result: string | null
  error: string | null
  updatedAt: number
  completedAt: number | null
}

async function pollOnce(socketId: string, taskId: string) {
  try {
    const res = await db.execute({
      sql: `SELECT id, type, status, progress, result, error, updatedAt, completedAt FROM "Task" WHERE id = ?`,
      args: [taskId],
    })
    if (res.rows.length === 0) {
      io.to(socketId).emit('error', { taskId, message: 'task not found' })
      stopSubscription(socketId)
      return
    }
    const row = res.rows[0] as unknown as TaskRow
    const sub = subscriptions.get(socketId)
    if (!sub) return

    const progress = Number(row.progress) || 0
    const status = String(row.status)

    if (progress !== sub.lastProgress || status !== sub.lastStatus) {
      sub.lastProgress = progress
      sub.lastStatus = status
      io.to(socketId).emit('progress', {
        taskId,
        type: row.type,
        progress,
        status,
        result: row.result ? JSON.parse(row.result) : null,
        error: row.error,
        updatedAt: row.updatedAt,
      })
    }

    if (status === 'succeeded' || status === 'failed') {
      io.to(socketId).emit('done', {
        taskId,
        type: row.type,
        status,
        progress,
        result: row.result ? JSON.parse(row.result) : null,
        error: row.error,
        completedAt: row.completedAt,
      })
      stopSubscription(socketId)
    }
  } catch (e) {
    console.error(`[ws-bus] poll error for ${taskId}:`, (e as Error).message)
  }
}

function stopSubscription(socketId: string) {
  const sub = subscriptions.get(socketId)
  if (sub) {
    clearInterval(sub.timer)
    subscriptions.delete(socketId)
  }
}

io.on('connection', (socket) => {
  console.log(`[ws-bus] client connected: ${socket.id}`)

  socket.on('subscribe', async ({ taskId }: { taskId: string }) => {
    if (!taskId) return
    stopSubscription(socket.id)
    await pollOnce(socket.id, taskId)
    const timer = setInterval(() => pollOnce(socket.id, taskId), 1200)
    subscriptions.set(socket.id, {
      taskId,
      lastProgress: -1,
      lastStatus: '',
      timer,
    })
  })

  socket.on('unsubscribe', () => {
    stopSubscription(socket.id)
  })

  socket.on('disconnect', () => {
    stopSubscription(socket.id)
    console.log(`[ws-bus] client disconnected: ${socket.id}`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[ws-bus] listening on :${PORT}`)
})

setInterval(async () => {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 30 * 60
    await db.execute({
      sql: `UPDATE "Task" SET status = 'failed', error = 'انتهت المهلة دون اكتمال المهمة.', completedAt = unixepoch(), updatedAt = unixepoch() WHERE status IN ('queued','running') AND updatedAt < ?`,
      args: [cutoff],
    })
  } catch (e) {
    console.error('[ws-bus] recovery error:', (e as Error).message)
  }
}, 120000)
