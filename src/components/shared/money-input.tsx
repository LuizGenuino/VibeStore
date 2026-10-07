import * as React from 'react'
import { Input } from '@/components/ui/input'
import { formatBrlInput, parseBrlInput } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Input monetário BRL: digita "1.234,56" → onChange recebe 1234.56 (2 casas, número)
 * ou null quando vazio/inválido. Nunca emite mais de 2 casas (INVALID_MONEY_VALUE).
 */
export function MoneyInput({
  value,
  onChange,
  allowNull = false,
  className,
  ...props
}: {
  value: number | null
  onChange: (v: number | null) => void
  allowNull?: boolean
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = React.useState(() => (value == null ? '' : formatBrlInput(value)))
  const [focused, setFocused] = React.useState(false)

  React.useEffect(() => {
    if (!focused) setText(value == null ? '' : formatBrlInput(value))
  }, [value, focused])

  return (
    <Input
      inputMode="decimal"
      placeholder="0,00"
      className={cn('tabular-nums', className)}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        const parsed = parseBrlInput(text)
        if (parsed == null) {
          if (!allowNull) {
            setText('0,00')
            onChange(0)
          } else {
            setText('')
            onChange(null)
          }
          return
        }
        setText(formatBrlInput(parsed))
        onChange(parsed)
      }}
      onChange={(e) => {
        const raw = e.target.value
        if (!/^[\d.,]*$/.test(raw)) return
        setText(raw)
        const parsed = parseBrlInput(raw)
        onChange(parsed)
      }}
      {...props}
    />
  )
}
