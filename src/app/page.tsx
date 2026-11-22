'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { OverviewTab } from '@/components/mcp/OverviewTab'
import { KeysTab } from '@/components/mcp/KeysTab'
import { TasksTab } from '@/components/mcp/TasksTab'
import { ConnectionTab } from '@/components/mcp/ConnectionTab'
import { StudioTab } from '@/components/mcp/StudioTab'
import { Zap, Github } from 'lucide-react'

interface ApiKey {
  id: string
  label: string
  masked: string
  sortOrder: number
  status: 'active' | 'exhausted' | 'invalid' | 'paused'
  lastError: string | null
  lastErrorAt: string | null
  lastUsedAt: string | null
  successCount: number
  failCount: number
  createdAt: string
}

export default function Home() {
  const [tab, setTab] = useState('overview')
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [keysLoading, setKeysLoading] = useState(true)

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys')
      const data = await res.json()
      setKeys(data.keys || [])
    } catch {
      // silent
    } finally {
      setKeysLoading(false)
    }
  }, [])

  useEffect(() => {
    loadKeys()
  }, [loadKeys])

  const activeCount = keys.filter((k) => k.status === 'active').length
  const totalCount = keys.length

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="rounded-lg bg-primary/15 p-2 text-primary">
            <Zap size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold leading-tight">خادم MCP لتوليد الوسائط</h1>
            <p className="text-xs text-muted-foreground">
              توليد الصور · توليد الفيديو بصوت · دمج المقاطع
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-soft" />
              نقطة /mcp تعمل
            </span>
            <span className="text-muted-foreground">
              المفاتيح: <span className="text-foreground font-medium nums">{activeCount}</span>/{totalCount}
            </span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-5">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList
            className="grid grid-cols-5 w-full mb-5"
            // Tailwind grid-cols-4 = 4 equal columns
          >
            <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
            <TabsTrigger value="keys">
              المفاتيح
              {totalCount > 0 && (
                <span className="ml-1 text-xs text-muted-foreground nums">({totalCount})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="tasks">المهام الحية</TabsTrigger>
            <TabsTrigger value="connection">الربط</TabsTrigger>
            <TabsTrigger value="studio">الاستوديو</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <OverviewTab onJump={setTab} />
          </TabsContent>

          <TabsContent value="keys" className="mt-0">
            {keysLoading ? (
              <div className="text-center text-muted-foreground p-8">جارٍ التحميل…</div>
            ) : (
              <KeysTab keys={keys} onChange={loadKeys} />
            )}
          </TabsContent>

          <TabsContent value="tasks" className="mt-0">
            <TasksTab />
          </TabsContent>

          <TabsContent value="connection" className="mt-0">
            <ConnectionTab />
          </TabsContent>

          <TabsContent value="studio" className="mt-0">
            <StudioTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/40 mt-auto">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>خادم MCP واحد · Next.js · Turso · MCP Streamable HTTP</span>
          <a
            href="https://github.com/1xnolosser-crypto/merger"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <Github size={12} /> المستودع
          </a>
        </div>
      </footer>
    </div>
  )
}
