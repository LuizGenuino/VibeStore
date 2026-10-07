import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { toastSuccess } from '@/lib/feedback'

export function CopyButton({
  text,
  label = 'Copiar',
  toastTitle = 'Copiado',
  ...props
}: { text: string; label?: string; toastTitle?: string } & Omit<ButtonProps, 'onClick'>) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          ta.remove()
        }
        setCopied(true)
        toastSuccess(toastTitle)
        setTimeout(() => setCopied(false), 1600)
      }}
      {...props}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
      {label}
    </Button>
  )
}
