'use client'

import { useState } from 'react'
import { Film, ShieldCheck, Play, KeyRound } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

export function StudioTab() {
  const [token, setToken] = useState('')
  const [title, setTitle] = useState('لماذا لا نشعر بدوران الأرض؟')
  const [format, setFormat] = useState<'shorts' | 'long'>('shorts')
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p')
  const [sceneText, setSceneText] = useState('تخيل أنك تقف على سطح الأرض الآن.\nالأرض تدور بسرعة كبيرة، ومع ذلك لا تشعر بالحركة.\nالسر هو أن الهواء وكل ما حولك يتحرك معك تقريبًا.\nنحن نشعر بتغير السرعة، لا بالحركة المنتظمة نفسها.\nوهكذا تبدو الأرض ثابتة رغم دورانها المستمر.\nوالآن تخيل أنك تراقب الحركة من الفضاء؛ ستلاحظ دورانًا مستمرًا ومنتظمًا.')
  const [narrationPath, setNarrationPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [taskId, setTaskId] = useState('')

  async function submit() {
    setMessage('')
    setTaskId('')
    const scenes = sceneText.split(/\r?\n/).map((text) => text.trim()).filter(Boolean)
    if (!token || token.length < 32) { setMessage('أدخل STUDIO_WORKER_TOKEN الذي أعددته في Vercel.'); return }
    if (!title.trim() || scenes.length === 0) { setMessage('أدخل عنوانًا ومشهدًا واحدًا على الأقل.'); return }
    if (scenes.length > 60) { setMessage('الحد الأقصى 60 مشهدًا.'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/studio/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          format,
          resolution,
          scenes: scenes.map((text) => ({ text, durationSeconds: format === 'shorts' ? 8 : 60 })),
          ...(narrationPath.trim() ? { narrationPath: narrationPath.trim() } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setTaskId(data.task_id)
      setMessage(`تم وضع المهمة في الطابور. المدة التقريبية: ${data.total_seconds} ثانية.`)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldCheck className="text-emerald-600 mt-0.5" size={20} />
          <div>
            <div className="font-semibold text-sm">محرك محلي بلا أرصدة توليد</div>
            <p className="text-xs text-muted-foreground mt-1">هذه المرحلة تستخدم FFmpeg على جهاز Windows. لا تستدعي KIE أو أي API لتوليد الصور أو الفيديو. أدخل صورًا محلية ومسار تعليق صوتي جاهزًا عند توفرهما.</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Film size={17}/> إنشاء مهمة مونتاج محلية</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="studio-token">رمز العامل المحلي (STUDIO_WORKER_TOKEN)</Label>
            <Input id="studio-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="أدخل الرمز الذي أعددته في Vercel" />
            <p className="text-xs text-muted-foreground">لا تضع هذا الرمز في المستودع أو تشاركه. يبقى في حالة الصفحة الحالية فقط.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="studio-title">عنوان الفيديو</Label>
            <Input id="studio-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180}/>
          </div>
          <div className="space-y-2">
            <Label htmlFor="studio-format">نوع الفيديو</Label>
            <select id="studio-format" className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={format} onChange={(e) => setFormat(e.target.value as 'shorts' | 'long')}>
              <option value="shorts">Shorts عمودي 9:16</option>
              <option value="long">فيديو طويل أفقي 16:9</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="studio-resolution">دقة التصدير</Label>
            <select id="studio-resolution" className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm" value={resolution} onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}>
              <option value="720p">720p — أخف وأسرع (موصى بها لهذا الجهاز)</option>
              <option value="1080p">1080p — أعلى جودة وحمل أكبر</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="studio-scenes">نصوص المشاهد (كل سطر مشهد مستقل)</Label>
            <Textarea id="studio-scenes" value={sceneText} onChange={(e) => setSceneText(e.target.value)} rows={8} className="text-sm" />
            <p className="text-xs text-muted-foreground">Shorts: 8 ثوانٍ لكل مشهد. الفيديو الطويل: 60 ثانية لكل مشهد؛ استخدم 6–12 مشهدًا مع تعليق صوتي وصور مناسبة للوصول إلى 6–12 دقيقة. يمكن إضافة الصور محليًا عبر مواصفة المهمة البرمجية.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="studio-audio">مسار ملف التعليق الصوتي على جهاز العامل (اختياري)</Label>
            <Input id="studio-audio" value={narrationPath} onChange={(e) => setNarrationPath(e.target.value)} placeholder="C:\Media\narration.wav" dir="ltr" />
          </div>
          <Button onClick={submit} disabled={busy} className="w-full"><Play size={16} className="mr-2"/>{busy ? 'جارٍ الإرسال…' : 'إضافة مهمة إلى الطابور'}</Button>
          {message && <div className="rounded-md border p-3 text-sm" role="status">{message}</div>}
          {taskId && <div className="flex items-center gap-2 flex-wrap"><Badge variant="outline">Queued</Badge><code className="text-xs break-all">{taskId}</code></div>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-start gap-2">
          <KeyRound size={16} className="text-muted-foreground mt-0.5"/>
          <p className="text-xs text-muted-foreground">لتشغيل العامل، شغّل <code>scripts/windows-studio-worker.ps1</code> على جهاز Windows بعد تثبيت FFmpeg وضبط STUDIO_WORKER_TOKEN في إعدادات Preview على Vercel. إذا لم يتوفر ملف صوت، سينتج العامل مسودة صامتة وينبهك بذلك.</p>
        </CardContent>
      </Card>
    </div>
  )
}
