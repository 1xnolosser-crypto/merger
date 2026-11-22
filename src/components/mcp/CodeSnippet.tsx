'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  code: string
  language?: string
  title?: string
}

export function CodeSnippet({ code, language = 'json', title }: Props) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('تم النسخ')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('تعذّر النسخ')
    }
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border bg-card">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/40">
        <span className="text-xs font-mono text-muted-foreground">{title || language}</span>
        <button
          onClick={onCopy}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
          aria-label="نسخ"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'تم النسخ' : 'نسخ'}
        </button>
      </div>
      <pre className="code-block !rounded-none !my-0">{code}</pre>
    </div>
  )
}
