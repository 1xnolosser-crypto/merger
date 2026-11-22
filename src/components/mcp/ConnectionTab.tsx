'use client'

import { useMemo, useState } from 'react'
import { Copy, Clipboard, Terminal, MessageSquare, Code2, Bot } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { CodeSnippet } from './CodeSnippet'

interface ClientConfig {
  id: string
  label: string
  icon: typeof Bot
  snippet: string
  language: string
  filename?: string
  hint?: string
}

export function ConnectionTab() {
  const [baseUrl] = useState(() =>
    typeof window !== 'undefined' ? window.location.origin : '',
  )

  const b = baseUrl || 'https://YOUR_DOMAIN'

  const configs = useMemo<ClientConfig[]>(() => {
    return [
      {
        id: 'chatgpt',
        label: 'ChatGPT Connectors',
        icon: Bot,
        language: 'URL',
        snippet: `${b}/mcp`,
        hint: 'في ChatGPT → Settings → Connectors → Add custom connector، الصق رابط /mcp ثم فعّل الأداة.',
      },
      {
        id: 'claude',
        label: 'Claude Desktop',
        icon: MessageSquare,
        language: 'json',
        filename: 'claude_desktop_config.json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              'media-gen': {
                url: `${b}/mcp`,
              },
            },
          },
          null,
          2,
        ),
        hint: 'ضع هذا في ملف claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/).',
      },
      {
        id: 'cursor',
        label: 'Cursor',
        icon: Code2,
        language: 'json',
        filename: '~/.cursor/mcp.json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              'media-gen': {
                url: `${b}/mcp`,
              },
            },
          },
          null,
          2,
        ),
        hint: 'Cursor → Settings → MCP → Add new MCP server → HTTP transport. أو ضع JSON في ~/.cursor/mcp.json.',
      },
      {
        id: 'windsurf',
        label: 'Windsurf',
        icon: Code2,
        language: 'json',
        filename: '~/.codeium/windsurf/mcp_config.json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              'media-gen': {
                serverUrl: `${b}/mcp`,
              },
            },
          },
          null,
          2,
        ),
        hint: 'Windsurf → Settings → MCP Servers → Add server. أو ضع JSON في المسار الموضّح.',
      },
      {
        id: 'cline',
        label: 'Cline',
        icon: Code2,
        language: 'json',
        filename: 'cline_mcp_settings.json',
        snippet: JSON.stringify(
          {
            mcpServers: {
              'media-gen': {
                url: `${b}/mcp`,
                disabled: false,
                alwaysAllow: ['generate_image', 'generate_video', 'merge_videos', 'get_task', 'list_recent_tasks'],
              },
            },
          },
          null,
          2,
        ),
        hint: 'Cline → MCP Servers → Edit global settings، ثم الصق JSON.',
      },
      {
        id: 'gpt-sdk',
        label: 'GPT Agents SDK',
        icon: Terminal,
        language: 'python',
        filename: 'agent.py',
        snippet: `from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp

mcp = MCPServerStreamableHttp(
    params={"url": "${b}/mcp"},
    cache_tools_list=True,
)

agent = Agent(
    name="media-agent",
    instructions="استخدم أدوات MCP لتوليد الصور والفيديو ودمج المقاطع.",
    mcp_servers=[mcp],
)

result = Runner.run_sync(agent, "ولّد صورة لمدينة ليلية بأمطار")
print(result.final_output)`,
        hint: 'تأكد من تثبيت openai-agents مع دعم MCP: pip install openai-agents',
      },
    ]
  }, [b])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clipboard size={16} className="text-primary" />
            إعدادات الربط الجاهزة للنسخ
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            اختر عميل MCP الذي تستخدمه. كل بطاقة تحتوي على مقتطف جاهز للّصق.
            استبدل النطاق بنطاقك الفعلي بعد النشر.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {configs.map((c) => {
              const Icon = c.icon
              return (
                <Card key={c.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Icon size={14} className="text-primary" />
                      {c.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {c.hint && <p className="text-xs text-muted-foreground">{c.hint}</p>}
                    {c.filename && (
                      <div className="text-xs font-mono text-muted-foreground" dir="ltr">
                        {c.filename}
                      </div>
                    )}
                    <CodeSnippet code={c.snippet} language={c.language} title={c.filename || c.language} />
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">بروتوكول الاستدعاء</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
            <li>العميل يُرسل <code className="font-mono text-foreground" dir="ltr">initialize</code> إلى <code className="font-mono text-foreground" dir="ltr">POST /mcp</code> للحصول على sessionId.</li>
            <li>العميل يستدعي <code className="font-mono text-foreground" dir="ltr">tools/list</code> لرؤية الأدوات الخمس.</li>
            <li>العميل يستدعي <code className="font-mono text-foreground" dir="ltr">tools/call</code> بأحد الأدوات (مثل <code className="font-mono text-foreground" dir="ltr">generate_image</code>) — يحصل على <code className="font-mono text-foreground" dir="ltr">task_id</code>.</li>
            <li>العميل يستدعي <code className="font-mono text-foreground" dir="ltr">get_task</code> كل ~10 ثوانٍ حتى <code className="font-mono text-foreground" dir="ltr">status="succeeded"</code>.</li>
            <li>يستخدم <code className="font-mono text-foreground" dir="ltr">result_url</code> في ردّه النهائي للمستخدم.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
