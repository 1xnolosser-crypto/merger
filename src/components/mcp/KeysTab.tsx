'use client'

import { useState } from 'react'
import { Plus, Loader2, Trash2, ArrowUp, ArrowDown, RotateCw, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

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

interface Props {
  keys: ApiKey[]
  onChange: () => void
}

const STATUS_META: Record<
  ApiKey['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  active: { label: 'نشط', variant: 'default' },
  exhausted: { label: 'نفد الرصيد', variant: 'destructive' },
  invalid: { label: 'غير صالح', variant: 'destructive' },
  paused: { label: 'متوقف', variant: 'secondary' },
}

export function KeysTab({ keys, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const addKey = async () => {
    if (!keyValue.trim()) {
      toast.error('أدخل قيمة المفتاح')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyValue: keyValue.trim(), label: label.trim() || 'Unnamed' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'فشل الإضافة')
        return
      }
      toast.success('أُضيف المفتاح')
      setKeyValue('')
      setLabel('')
      setAdding(false)
      onChange()
    } catch {
      toast.error('خطأ في الشبكة')
    } finally {
      setBusy(false)
    }
  }

  const reorder = async (k: ApiKey, dir: 'up' | 'down') => {
    const idx = keys.findIndex((x) => x.id === k.id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= keys.length) return
    const other = keys[swapIdx]
    await fetch(`/api/keys/${k.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: other.sortOrder }),
    })
    await fetch(`/api/keys/${other.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder: k.sortOrder }),
    })
    toast.success('تم إعادة الترتيب')
    onChange()
  }

  const setStatus = async (k: ApiKey, status: ApiKey['status']) => {
    await fetch(`/api/keys/${k.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    toast.success('تم تحديث الحالة')
    onChange()
  }

  const remove = async (k: ApiKey) => {
    if (!confirm(`حذف المفتاح "${k.label}"؟`)) return
    await fetch(`/api/keys/${k.id}`, { method: 'DELETE' })
    toast.success('حُذف المفتاح')
    onChange()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">إدارة مفاتيح KIE القديمة</CardTitle>
        </CardHeader>
        <CardContent>
          {!adding ? (
            <Button disabled variant="default">
              <Plus size={16} /> التوليد المدفوع معطّل
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                <div>
                  <Label htmlFor="k-label">الاسم (اختياري)</Label>
                  <Input
                    id="k-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="مثال: احتياطي 1"
                  />
                </div>
                <div>
                  <Label htmlFor="k-value">قيمة المفتاح</Label>
                  <Input
                    id="k-value"
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    placeholder="KIE معطّل — لا تضف مفاتيح"
                    dir="ltr"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={addKey} disabled={busy}>
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  حفظ
                </Button>
                <Button variant="outline" onClick={() => setAdding(false)}>
                  إلغاء
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                تُجرَّب المفاتيح بالترتيب التصاعدي حسب رقم الترتيب. عند فشل مفتاح يُنتقل تلقائيًا
                للتالي دون إيقاف المهمة.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            المفاتيح المُخزّنة <span className="text-muted-foreground">({keys.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              لا توجد مفاتيح بعد. مفاتيح KIE غير مستخدمة حاليًا. التوليد المدفوع محظور لحماية رصيدك.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {keys.map((k, i) => {
                const meta = STATUS_META[k.status]
                return (
                  <div key={k.id} className="flex items-start gap-3 p-4">
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <span className="font-mono">#{k.sortOrder}</span>
                      <button
                        onClick={() => reorder(k, 'up')}
                        disabled={i === 0}
                        className="hover:text-primary disabled:opacity-30"
                        aria-label="تحريك لأعلى"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => reorder(k, 'down')}
                        disabled={i === keys.length - 1}
                        className="hover:text-primary disabled:opacity-30"
                        aria-label="تحريك لأسفل"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{k.label}</span>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <span className="text-xs font-mono text-muted-foreground" dir="ltr">
                          {k.masked}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                        <span>نجاح: <span className="nums text-foreground">{k.successCount}</span></span>
                        <span>فشل: <span className="nums text-foreground">{k.failCount}</span></span>
                        {k.lastUsedAt && (
                          <span>
                            آخر استخدام: <span className="nums text-foreground">{formatRelative(k.lastUsedAt)}</span>
                          </span>
                        )}
                        {k.lastError && (
                          <span className="text-destructive">
                            آخر خطأ: {k.lastError.slice(0, 80)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {k.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus(k, 'paused')}
                          title="إيقاف مؤقت"
                        >
                          <Pause size={14} />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus(k, 'active')}
                          title="تفعيل"
                        >
                          <Play size={14} />
                        </Button>
                      )}
                      {k.status === 'exhausted' || k.status === 'invalid' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatus(k, 'active')}
                          title="إعادة المحاولة"
                        >
                          <RotateCw size={14} />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(k)}
                        title="حذف"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
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
  const d = Math.floor(h / 24)
  return `قبل ${d}ي`
}
