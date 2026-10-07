import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@/lib/constants'
import type { OrderStatus, ProductStatus } from '@/types/backend'
import { cn } from '@/lib/utils'

const toneClass: Record<string, string> = {
  warning: 'border-transparent bg-warning/15 text-warning',
  info: 'border-transparent bg-secondary/10 text-secondary',
  primary: 'border-transparent bg-primary/10 text-primary',
  success: 'border-transparent bg-success/10 text-success',
  muted: 'border-transparent bg-muted text-muted-foreground',
  destructive: 'border-transparent bg-destructive/10 text-destructive',
}

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <Badge className={cn(toneClass[ORDER_STATUS_TONES[status]], className)}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  )
}

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  return (
    <Badge className={status === 'ACTIVE' ? toneClass.success : toneClass.muted}>
      {status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
    </Badge>
  )
}

/** Chip mono para códigos (PED-000123, PRD-000001, CAT-000001) — assinatura visual do produto. */
export function CodeChip({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-xs font-medium tracking-tight text-foreground/80',
        className,
      )}
    >
      {code}
    </span>
  )
}
