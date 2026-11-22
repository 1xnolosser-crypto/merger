'use client'

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { Loader2, RefreshCw, ExternalLink, Activity, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

interface TaskRow {
  task_id: string
  type: 'image' | 'video' | 'merge'
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  progress: number
  params: unknown
  result: { url?: string; sizeBytes?: number; durationSeconds?: number } | null
  error: string | null
  usedKeyLabel: string | null
  attempts: number
  durationMs: number | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

interface WsProgress {
  taskId: string
  type?: string
  progress: number
  status: string
  result?: { url?: string } | null
  error?: string | null
}

const TYPE_LABEL = { image: 'صورة', video: 'فيديو', merge: 'دمج' }
const STATUS_META: Record<
  string,
  { label: string; icon: typeof CheckCircle2; color: string }
> = {
  queued: { label: 'في الانتظار', icon: Clock, color: 'text-muted-foreground' },
  running: { label: 'قيد التنفيذ', icon: Loader2, color: 'text-primary' },
  succeeded: { label: 'مكتمل', icon: CheckCircle2, color: 'text-emerald-600' },
  failed: { label: 'فشل', icon: XCircle, color: 'text-destructive' },
}

export function TasksTab() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [subscribed, setSubscribed] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  const loadTasks = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tasks?limit=50')
      const data = await res.json()
      setTasks(data.tasks || [])
    } catch {
      toast.error('فشل تحميل المهام')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
    const poll = setInterval(loadTasks, 8000)
    return () => clearInterval(poll)
  }, [])

  // Open a single WS subscription to all running tasks (one socket, multiple subscriptions).
  // Skipped entirely when NEXT_PUBLIC_WS_URL is unset (e.g. on Vercel where the
  // socket.io mini-service isn't deployed) — the 8s polling below is the source of truth.
  useEffect(() => {
    const WS_URL = process.env.NEXT_PUBLIC_WS_URL
    if (!WS_URL) return
    if (socketRef.current) return
    const sock = io(WS_URL, {
      path: '/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    })
    socketRef.current = sock

    sock.on('connect', () => {
      // Subscribe to all running/queued tasks
      setTasks((curr) => {
        for (const t of curr) {
          if (t.status === 'queued' || t.status === 'running') {
            sock.emit('subscribe', { taskId: t.task_id })
          }
        }
        return curr
      })
    })

    sock.on('progress', (p: WsProgress) => {
      setTasks((curr) =>
        curr.map((t) =>
          t.task_id === p.taskId
            ? {
                ...t,
                progress: p.progress,
                status: p.status as TaskRow['status'],
                result: p.result as TaskRow['result'],
                error: p.error ?? null,
                updated_at: new Date().toISOString(),
              }
            : t,
        ),
      )
    })

    sock.on('done', (p: WsProgress) => {
      setTasks((curr) =>
        curr.map((t) =>
          t.task_id === p.taskId
            ? {
                ...t,
                progress: p.progress,
                status: p.status as TaskRow['status'],
                result: p.result as TaskRow['result'],
                error: p.error ?? null,
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }
            : t,
        ),
      )
      // Subscribe to any remaining running tasks
      setTimeout(loadTasks, 600)
    })

    sock.on('connect_error', () => {
      // Silent — UI falls back to polling
    })

    return () => {
      sock.disconnect()
      socketRef.current = null
    }
  }, [])

  // Watch tasks state; subscribe to any new running ones
  useEffect(() => {
    if (!socketRef.current || socketRef.current.connected === false) return
    for (const t of tasks) {
      if (t.status === 'queued' || t.status === 'running') {
        socketRef.current.emit('subscribe', { taskId: t.task_id })
      }
    }
  }, [tasks])

  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued')
  const completed = tasks.filter((t) => t.status === 'succeeded' || t.status === 'failed')

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity size={16} className="text-primary" />
            المهام الحية <span className="text-muted-foreground">({running.length} نشطة)</span>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={loadTasks} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            تحديث
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {running.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              لا توجد مهام نشطة حاليًا. جرّب الأدوات من عميل MCP لبدء التوليد.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {running.map((t) => (
                <TaskCard key={t.task_id} t={t} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {completed.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">آخر المهام المكتملة</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {completed.slice(0, 15).map((t) => (
                <TaskCard key={t.task_id} t={t} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TaskCard({ t }: { t: TaskRow }) {
  const meta = STATUS_META[t.status] || STATUS_META.queued
  const Icon = meta.icon
  const isRunning = t.status === 'running'
  const isDone = t.status === 'succeeded' || t.status === 'failed'

  const params = t.params as
    | { prompt?: string; urls?: string[]; name?: string }
    | null

  const desc =
    t.type === 'merge'
      ? params?.urls
        ? `دمج ${params.urls.length} مقاطع`
        : 'دمج'
      : params?.prompt
        ? `"${params.prompt.slice(0, 80)}${params.prompt.length > 80 ? '…' : ''}"`
        : '(بدون وصف)'

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-start gap-3">
        <Icon
          size={18}
          className={`${meta.color} ${isRunning ? 'animate-spin' : ''} mt-0.5 shrink-0`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {TYPE_LABEL[t.type]}
            </Badge>
            <span className="font-medium text-sm">{desc}</span>
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-1 break-all" dir="ltr">
            {t.task_id}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>
              أُنشئ: <span className="nums text-foreground">{formatRelative(t.created_at)}</span>
            </span>
            {t.completed_at && t.durationMs != null && (
              <span>
                المدة: <span className="nums text-foreground">{(t.durationMs / 1000).toFixed(1)}ث</span>
              </span>
            )}
            {t.usedKeyLabel && (
              <span>
                المفتاح: <span className="text-foreground">{t.usedKeyLabel}</span>
                <span className="text-muted-foreground"> (محاولة #{t.attempts})</span>
              </span>
            )}
          </div>
        </div>
        {isDone && t.result?.url && (
          <a
            href={t.result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
          >
            فتح <ExternalLink size={12} />
          </a>
        )}
      </div>

      {(isRunning || t.status === 'queued') && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{meta.label}</span>
            <span className="nums">{t.progress}%</span>
          </div>
          <Progress value={t.progress} className="h-1.5" />
        </div>
      )}

      {t.status === 'failed' && t.error && (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
          {t.error}
        </div>
      )}

      {t.status === 'succeeded' && t.result?.url && (
        <div className="text-xs break-all">
          <a
            href={t.result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-mono"
            dir="ltr"
          >
            {t.result.url}
          </a>
          {t.result.sizeBytes && (
            <span className="text-muted-foreground mr-2">
              ({(t.result.sizeBytes / 1024 / 1024).toFixed(2)} MB)
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - t)
  const s = Math.floor(diff / 1000)
  if (s < 60) return `قبل ${s}ث`
  const m = Math.floor(s / 60)
  if (m < 60) return `قبل ${m}د`
  const h = Math.floor(m / 60)
  if (h < 24) return `قبل ${h}س`
  return `قبل ${Math.floor(h / 24)}ي`
}
