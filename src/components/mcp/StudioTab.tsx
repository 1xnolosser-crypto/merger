'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Film, Download, BookOpen, ShieldCheck, Terminal } from 'lucide-react'

const guideUrl = 'https://github.com/1xnolosser-crypto/merger/blob/feat/free-hybrid-video-studio/docs/free-video-studio-ar.md'
const exampleUrl = 'https://raw.githubusercontent.com/1xnolosser-crypto/merger/feat/free-hybrid-video-studio/examples/free-video-project.json'
const repoUrl = 'https://github.com/1xnolosser-crypto/merger/tree/feat/free-hybrid-video-studio'

export function StudioTab() {
  return (
    <div className="space-y-4">
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldCheck className="text-emerald-600 mt-0.5" size={21} />
          <div className="space-y-1">
            <div className="font-semibold text-sm">المسار المجاني المحلي المعتمد</div>
            <p className="text-xs text-muted-foreground">
              لا Agnes، لا KIE، لا مفاتيح API، لا أرصدة ولا اشتراكات. تتم معالجة الفيديو على جهاز Windows باستخدام FFmpeg.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="outline">Wikimedia Commons</Badge>
              <Badge variant="outline">Edge TTS عربي</Badge>
              <Badge variant="outline">FFmpeg محلي</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Film size={18} /> كيف ينشئ الفيديو؟
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>1. تكتب نص كل مشهد وتحدد كلمات بحث إنجليزية للصورة المناسبة.</p>
          <p>2. يبحث البرنامج في Wikimedia Commons ويقبل ملفات CC0 أو Public Domain أو CC BY فقط.</p>
          <p>3. ينشئ تعليقًا عربيًا، ويضيف الترجمة والحركة، ثم يصدر MP4 بدقة 720p.</p>
          <p className="text-xs text-muted-foreground">
            الناتج فيديو وثائقي من صور حقيقية مرخصة مع حركة وانتقالات؛ ليس توليدًا اصطناعيًا لمشاهد جديدة من النص. خدمة Edge TTS تحتاج الإنترنت وقد تتغير إتاحتها، لكنها لا تتطلب مفتاح API.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Terminal size={17} /> التشغيل على Windows
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>حمّل ملفات المشروع المجاني وافتح مجلد Merger في جهازك.</li>
            <li>عدّل ملف <code>examples/free-video-project.json</code> بالنصوص التي تريدها.</li>
            <li>شغّل الأمر التالي من PowerShell:</li>
          </ol>
          <div className="rounded-md bg-muted p-3 font-mono text-sm" dir="ltr">
            .\scripts\run-free-video.ps1
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={guideUrl} target="_blank" rel="noreferrer">
                <BookOpen size={16} className="mr-2" /> دليل التشغيل
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={exampleUrl} target="_blank" rel="noreferrer">
                <Download size={16} className="mr-2" /> نموذج مشروع الفيديو
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={repoUrl} target="_blank" rel="noreferrer">ملفات المشروع</a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            المتطلبات: Python 3.12 وFFmpeg وFFprobe واتصال إنترنت لتنزيل الصور وإنشاء الصوت. لا يتم رفع الفيديو إلى السحابة؛ يبقى على جهازك.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
