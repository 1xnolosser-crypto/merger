'use client'

import { Image, Video, Merge, ListChecks, Eye, Plug, Server, Zap, ShieldCheck, KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CodeSnippet } from './CodeSnippet'
import { useOrigin } from '@/lib/use-origin'

interface Props {
  onJump: (tab: string) => void
}

interface ToolMeta {
  name: string
  arabicName: string
  icon: typeof Image
  description: string
  model?: string
  returns: string
}

const TOOLS: ToolMeta[] = [
  {
    name: 'generate_image',
    arabicName: 'توليد صورة',
    icon: Image,
    description: 'التوليد السحابي المدفوع متوقف حاليًا لحماية الرصيد. لم يتم ربط مولّد مجاني بديل بعد.',
    model: 'محمي: لا توجد طلبات مدفوعة',
    returns: '{ task_id, status: "queued", progress: 0 }',
  },
  {
    name: 'generate_video',
    arabicName: 'توليد فيديو',
    icon: Video,
    description: 'التوليد السحابي المدفوع متوقف حاليًا لحماية الرصيد. لم يتم ربط مولّد مجاني بديل بعد.',
    model: 'محمي: لا توجد طلبات مدفوعة',
    returns: '{ task_id, status: "queued", progress: 0 }',
  },
  {
    name: 'merge_videos',
    arabicName: 'دمج المقاطع',
    icon: Merge,
    description: 'يدمج عدة روابط فيديو في مقطع واحد بالترتيب المطلوب. النتيجة تُرفع على استضافة عامة ويُعاد رابطها.',
    returns: '{ task_id, status: "queued", progress: 0 }',
  },
  {
    name: 'get_task',
    arabicName: 'استعلام عن مهمة',
    icon: Eye,
    description: 'يستعيد الحالة الحالية لمهمة (status, progress, result_url). يُستدعى كل ~10 ثوانٍ حتى اكتمال المهمة.',
    returns: '{ task_id, status, progress, result_url?, error? }',
  },
  {
    name: 'list_recent_tasks',
    arabicName: 'قائمة المهام',
    icon: ListChecks,
    description: 'يعرض آخر 20 مهمة (بأي حالة) لاستعادة السياق بعد إعادة تشغيل العميل.',
    returns: '{ tasks: [{ task_id, type, status, progress, ... }] }',
  },
]

export function OverviewTab({ onJump }: Props) {
  const baseUrl = useOrigin()

  const curlExample = `curl -X POST ${baseUrl}/mcp \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "demo", "version": "1.0" }
    }
  }'`

  return (
    <div className="space-y-4">
      {/* Hero */}
      <Card className="bg-gradient-to-br from-primary/10 via-accent/30 to-background">
        <CardContent className="p-6">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="rounded-xl bg-primary/15 p-3 text-primary">
              <Zap size={28} />
            </div>
            <div className="flex-1 min-w-[260px]">
              <h1 className="text-xl font-bold">خادم MCP لتوليد الوسائط</h1>
              <p className="text-sm text-muted-foreground mt-1">
                أداة واحدة تجمع توليد الصور، توليد الفيديو بصوت متزامن، ودمج المقاطع —
                قابلة للوصول من أي عميل MCP.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="outline" className="gap-1">
                  <Server size={12} /> Streamable HTTP
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck size={12} /> لا يُنزَّل أي ملف
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <KeyRound size={12} /> حظر التوليد المدفوع
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Endpoint */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug size={16} className="text-primary" />
            نقطة نهاية MCP
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            هذه نقطة النهاية الوحيدة لـ MCP. تعمل بنقل Streamable HTTP حسب مواصفات MCP.
            تدعم POST (لطلبات JSON-RPC)، GET (للبث SSE)، DELETE (لإنهاء الجلسة).
          </p>
          <CodeSnippet
            code={`${baseUrl}/mcp`}
            language="URL"
            title="Endpoint URL"
          />
          <CodeSnippet code={curlExample} language="bash" title="curl — initialize handshake" />
        </CardContent>
      </Card>

      {/* Tools */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap size={16} className="text-primary" />
            الأدوات الخمس المعروضة للعميل
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {TOOLS.map((t) => {
              const Icon = t.icon
              return (
                <div key={t.name} className="flex items-start gap-3 p-4">
                  <div className="rounded-md bg-primary/10 p-2 text-primary shrink-0">
                    <Icon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium" dir="ltr">{t.name}</span>
                      <span className="text-sm text-muted-foreground">— {t.arabicName}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{t.description}</p>
                    {t.model && (
                      <div className="text-xs text-muted-foreground mt-1.5">
                        النموذج: <span className="font-mono text-foreground" dir="ltr">{t.model}</span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      المُخرَجات: <code className="font-mono text-foreground" dir="ltr">{t.returns}</code>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Core principles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <PrincipleCard
          icon={ShieldCheck}
          title="بدون تنزيل للملفات"
          body="نرسل الروابط للمزودين ونخزّن روابط النتائج فقط في قاعدة البيانات. الملفات تبقى على بنية المزود أو خدمة الدمج."
        />
        <PrincipleCard
          icon={KeyRound}
          title="حماية من استهلاك الرصيد"
          body="تم تعطيل مفاتيح KIE ومسار التوليد المدفوع بالكامل. لا يتم إرسال أي طلب إلى مزود مدفوع حتى عند فشل الخدمة المجانية."
        />
        <PrincipleCard
          icon={Zap}
          title="توليد غير متزامن"
          body="الأداة تُعيد task_id فورًا. العميل يستدعي get_task كل ~10 ثوانٍ حتى يصبح status=succeeded."
        />
      </div>

      <div className="flex flex-wrap gap-2 justify-center pt-2">
        <button
          onClick={() => onJump('keys')}
          className="text-sm text-primary hover:underline"
        >
          إدارة المفاتيح ←
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          onClick={() => onJump('tasks')}
          className="text-sm text-primary hover:underline"
        >
          متابعة المهام ←
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          onClick={() => onJump('connection')}
          className="text-sm text-primary hover:underline"
        >
          إعداد الربط ←
        </button>
      </div>
    </div>
  )
}

function PrincipleCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap
  title: string
  body: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon size={16} className="text-primary" />
          <h3 className="font-medium text-sm">{title}</h3>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  )
}
