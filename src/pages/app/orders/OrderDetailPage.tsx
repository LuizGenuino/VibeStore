import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Loader2, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'
import { ordersService, type OrderDetail } from '@/services/orders.service'
import { useHasStorePerm } from '@/stores/access'
import {
  ORDER_EVENT_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/lib/constants'
import { BackendError } from '@/lib/rpc'
import { toastError, toastSuccess } from '@/lib/feedback'
import { brl } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { productImageUrl } from '@/lib/media'
import type {
  ManualMethod,
  OrdersRow,
  ReturnDisposition,
  Uuid,
} from '@/types/backend'
import { PageHeader } from '@/components/shared/page-header'
import {
  ErrorRetryState,
  ForbiddenState,
  NotFoundState,
} from '@/components/shared/page-state'
import { CharCount, FormField } from '@/components/shared/form'
import { MoneyInput } from '@/components/shared/money-input'
import { CodeChip, OrderStatusBadge } from '@/components/shared/order-status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

type DialogKind = 'terms' | 'pay' | 'ship' | 'deliver' | 'cancel' | 'return'

const RESERVATION_STATE_LABELS: Record<'HELD' | 'RELEASED' | 'CONSUMED', string> = {
  HELD: 'Reservada',
  RELEASED: 'Liberada',
  CONSUMED: 'Consumida',
}

const RETURN_DISPOSITION_LABELS: Record<ReturnDisposition, string> = {
  RESTOCKED: 'Volta ao estoque',
  DAMAGED: 'Perda',
}

const noteValid = (n: string) => n.trim().length >= 3 && n.trim().length <= 1000

/** Seleção de forma de pagamento/reembolso manual. */
function MethodSelect({
  value,
  onChange,
  id,
}: {
  value: ManualMethod
  onChange: (v: ManualMethod) => void
  id?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ManualMethod)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PAYMENT_METHOD_LABELS) as ManualMethod[]).map((m) => (
          <SelectItem key={m} value={m}>
            {PAYMENT_METHOD_LABELS[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Campo de nota obrigatória (3..1000) compartilhado pelas ações. */
function NoteField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: string | null
}) {
  return (
    <FormField
      label="Nota"
      htmlFor="order-action-note"
      required
      error={error}
      hint={undefined}
    >
      <Textarea
        id="order-action-note"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Ex.: combinado com o cliente pelo WhatsApp"
      />
      <div className="flex justify-end">
        <CharCount value={value} max={1000} />
      </div>
    </FormField>
  )
}

interface ActionDialogProps {
  order: OrdersRow
  items: OrderDetail['items']
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (title: string) => void
  onError: (e: unknown) => void
}

/** Confirmar frete (PENDING, repetível). 0 = frete grátis confirmado. */
function ConfirmTermsDialog({ order, open, onOpenChange, onSuccess, onError }: ActionDialogProps) {
  const [shipping, setShipping] = useState<number | null>(order.shipping_amount)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (shipping == null || shipping < 0) return
    if (!noteValid(note)) {
      setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      return
    }
    setBusy(true)
    try {
      await ordersService.confirmTerms(order, shipping, note.trim())
      onSuccess('Frete confirmado')
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar frete</DialogTitle>
          <DialogDescription>
            Você pode ajustar o frete quantas vezes precisar enquanto o pedido estiver pendente.
            Valor 0 confirma frete grátis.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Valor do frete" htmlFor="terms-shipping" required>
            <MoneyInput id="terms-shipping" value={shipping} onChange={setShipping} />
          </FormField>
          <NoteField value={note} onChange={setNote} error={noteError} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={busy || shipping == null}>
            {busy && <Loader2 className="animate-spin" />}
            Confirmar frete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Confirmar pagamento (PENDING + frete confirmado). Declaração do lojista — sem movimentação de dinheiro. */
function ConfirmPaymentDialog({ order, open, onOpenChange, onSuccess, onError }: ActionDialogProps) {
  const [method, setMethod] = useState<ManualMethod>('PIX')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [received, setReceived] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!received) return
    if (!noteValid(note)) {
      setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      return
    }
    setBusy(true)
    try {
      await ordersService.confirmPayment(order, method, note.trim(), reference.trim() || undefined)
      onSuccess('Pagamento confirmado')
    } catch (e) {
      if (e instanceof BackendError && e.code === 'ORDER_NOTE_REQUIRED') setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar pagamento</DialogTitle>
          <DialogDescription>
            O VibeStore não movimenta dinheiro nem verifica banco ou Pix: esta confirmação é a sua
            declaração de que o valor foi recebido.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Valor recebido" htmlFor="pay-amount" hint="Igual ao total do pedido; não pode ser alterado.">
            <Input id="pay-amount" value={brl(order.total)} readOnly disabled className="tabular-nums" />
          </FormField>
          <FormField label="Forma de pagamento" htmlFor="pay-method" required>
            <MethodSelect id="pay-method" value={method} onChange={setMethod} />
          </FormField>
          <FormField label="Referência" htmlFor="pay-ref" hint="Comprovante, id da transação… (opcional)">
            <Input
              id="pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value.slice(0, 160))}
              maxLength={160}
            />
          </FormField>
          <NoteField value={note} onChange={setNote} error={noteError} />
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={received}
              onCheckedChange={(c) => setReceived(c === true)}
              className="mt-0.5"
            />
            <span>
              Confirmo que o valor de <strong>{brl(order.total)}</strong> foi recebido do cliente.
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={busy || !received}>
            {busy && <Loader2 className="animate-spin" />}
            Confirmar pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Enviar (PAID). Rastreio opcional. */
function ShipDialog({ order, open, onOpenChange, onSuccess, onError }: ActionDialogProps) {
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!noteValid(note)) {
      setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      return
    }
    setBusy(true)
    try {
      await ordersService.ship(order, note.trim(), tracking.trim() || undefined)
      onSuccess('Pedido enviado')
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar pedido</DialogTitle>
          <DialogDescription>Marque o pedido como enviado ao cliente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Código de rastreio" htmlFor="ship-tracking" hint="Opcional, até 120 caracteres.">
            <Input
              id="ship-tracking"
              value={tracking}
              onChange={(e) => setTracking(e.target.value.slice(0, 120))}
              maxLength={120}
            />
          </FormField>
          <NoteField value={note} onChange={setNote} error={noteError} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Confirmar envio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Entregue (SHIPPED). */
function DeliverDialog({ order, open, onOpenChange, onSuccess, onError }: ActionDialogProps) {
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!noteValid(note)) {
      setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      return
    }
    setBusy(true)
    try {
      await ordersService.deliver(order, note.trim())
      onSuccess('Pedido entregue')
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como entregue</DialogTitle>
          <DialogDescription>Confirme que o cliente recebeu o pedido.</DialogDescription>
        </DialogHeader>
        <NoteField value={note} onChange={setNote} error={noteError} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            Confirmar entrega
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Cancelar (PENDING: só nota · PAID: reembolso declarado obrigatório). */
function CancelDialog({ order, open, onOpenChange, onSuccess, onError }: ActionDialogProps) {
  const isPaid = order.status === 'PAID'
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [method, setMethod] = useState<ManualMethod>('PIX')
  const [reference, setReference] = useState('')
  const [refunded, setRefunded] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!noteValid(note)) {
      setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      return
    }
    if (isPaid && !refunded) return
    setBusy(true)
    try {
      await ordersService.cancel(
        order,
        note.trim(),
        isPaid ? { method, reference: reference.trim() || undefined } : undefined,
      )
      onSuccess('Pedido cancelado')
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar pedido</DialogTitle>
          <DialogDescription>
            {isPaid
              ? 'O estoque será reposto e o cancelamento exige a declaração de reembolso integral.'
              : 'A reserva de estoque será liberada. Esta ação é definitiva.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {isPaid && (
            <>
              <FormField label="Forma do reembolso" htmlFor="cancel-method" required>
                <MethodSelect id="cancel-method" value={method} onChange={setMethod} />
              </FormField>
              <FormField label="Referência do reembolso" htmlFor="cancel-ref" hint="Comprovante, id da transação… (opcional)">
                <Input
                  id="cancel-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.slice(0, 160))}
                  maxLength={160}
                />
              </FormField>
            </>
          )}
          <NoteField value={note} onChange={setNote} error={noteError} />
          {isPaid && (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={refunded}
                onCheckedChange={(c) => setRefunded(c === true)}
                className="mt-0.5"
              />
              <span>
                Já devolvi integralmente <strong>{brl(order.total)}</strong> ao cliente.
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy || (isPaid && !refunded)}>
            {busy && <Loader2 className="animate-spin" />}
            Cancelar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Devolução integral (SHIPPED/DELIVERED) — disposição por item + reembolso declarado. */
function ReturnDialog({ order, items, open, onOpenChange, onSuccess, onError }: ActionDialogProps) {
  const [dispositions, setDispositions] = useState<Record<Uuid, ReturnDisposition>>(() =>
    Object.fromEntries(items.map((i) => [i.id, 'RESTOCKED' as ReturnDisposition])),
  )
  const [goodsReceived, setGoodsReceived] = useState(false)
  const [refunded, setRefunded] = useState(false)
  const [method, setMethod] = useState<ManualMethod>('PIX')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!goodsReceived || !refunded) return
    if (!noteValid(note)) {
      setNoteError('Informe uma nota (mínimo de 3 caracteres).')
      return
    }
    setBusy(true)
    try {
      await ordersService.returnAll(
        order,
        items.map((i) => ({ order_item_id: i.id, disposition: dispositions[i.id] ?? 'RESTOCKED' })),
        method,
        note.trim(),
        reference.trim() || undefined,
      )
      onSuccess('Devolução registrada')
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Registrar devolução</DialogTitle>
          <DialogDescription>
            A devolução é integral: informe o destino de cada item. Itens que voltam ao estoque são
            repostos; itens danificados viram perda.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <p className="text-sm font-medium">
                  {item.product_name} <span className="text-muted-foreground">× {item.quantity}</span>
                </p>
                <RadioGroup
                  className="mt-2 gap-2"
                  value={dispositions[item.id] ?? 'RESTOCKED'}
                  onValueChange={(v) =>
                    setDispositions((d) => ({ ...d, [item.id]: v as ReturnDisposition }))
                  }
                >
                  {(Object.keys(RETURN_DISPOSITION_LABELS) as ReturnDisposition[]).map((d) => (
                    <label
                      key={d}
                      className="flex cursor-pointer items-center gap-2 text-sm font-normal"
                    >
                      <RadioGroupItem value={d} id={`ret-${item.id}-${d}`} />
                      {RETURN_DISPOSITION_LABELS[d]}
                    </label>
                  ))}
                </RadioGroup>
              </div>
            ))}
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={goodsReceived}
              onCheckedChange={(c) => setGoodsReceived(c === true)}
              className="mt-0.5"
            />
            Recebi os produtos de volta
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              checked={refunded}
              onCheckedChange={(c) => setRefunded(c === true)}
              className="mt-0.5"
            />
            <span>
              Já devolvi <strong>{brl(order.total)}</strong> ao cliente (inclui frete)
            </span>
          </label>
          <FormField label="Forma do reembolso" htmlFor="return-method" required>
            <MethodSelect id="return-method" value={method} onChange={setMethod} />
          </FormField>
          <FormField label="Referência do reembolso" htmlFor="return-ref" hint="Comprovante, id da transação… (opcional)">
            <Input
              id="return-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value.slice(0, 160))}
              maxLength={160}
            />
          </FormField>
          <NoteField value={note} onChange={setNote} error={noteError} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={busy || !goodsReceived || !refunded}>
            {busy && <Loader2 className="animate-spin" />}
            Registrar devolução
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-48" />
    </div>
  )
}

/** /app/orders/:orderId (guia 13.3/13.4) — detalhe completo + ações da máquina de estados. */
export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const canRead = useHasStorePerm('orders.read')
  const canTerms = useHasStorePerm('orders.terms')
  const canPay = useHasStorePerm('orders.pay')
  const canShip = useHasStorePerm('orders.ship')
  const canDeliver = useHasStorePerm('orders.deliver')
  const canCancel = useHasStorePerm('orders.cancel')
  const canReturn = useHasStorePerm('orders.return')

  const [dialog, setDialog] = useState<DialogKind | null>(null)
  const [stockWarning, setStockWarning] = useState(false)

  const q = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => ordersService.getOrderDetail(orderId!),
    enabled: !!orderId && canRead,
  })

  if (!canRead) return <ForbiddenState />
  if (q.isLoading) return <DetailSkeleton />
  if (q.isError) return <ErrorRetryState onRetry={() => q.refetch()} retrying={q.isFetching} />
  const detail = q.data
  if (!detail?.order) {
    return <NotFoundState title="Pedido não encontrado" backTo="/app/orders" backLabel="Voltar aos pedidos" />
  }

  const { order, items, history, payments, reservations, returns } = detail
  const closeDialog = () => setDialog(null)

  function onActionSuccess(title: string) {
    closeDialog()
    void q.refetch()
    toastSuccess(title)
  }

  function onActionError(e: unknown) {
    if (e instanceof BackendError && e.code === 'STALE_ORDER_REVISION') {
      closeDialog()
      void q.refetch()
      toast.error('O pedido foi atualizado por outra ação. Revise e tente novamente.')
      return
    }
    if (e instanceof BackendError && e.code === 'SHIPPING_TERMS_NOT_CONFIRMED') {
      setDialog('terms')
      return
    }
    if (e instanceof BackendError && e.code === 'INSUFFICIENT_AVAILABLE_STOCK_FOR_PAYMENT') {
      closeDialog()
      setStockWarning(true)
      return
    }
    toastError(e)
  }

  const phoneDigits = order.customer_snapshot.phone.replace(/\D/g, '')
  const addr = order.delivery_address
  const cep = addr.postal_code
    ? `${addr.postal_code.slice(0, 5)}-${addr.postal_code.slice(5)}`
    : ''
  const returnByItem = new Map(items.map((i) => [i.id, i.product_name]))

  const dialogProps = {
    order,
    items,
    onSuccess: onActionSuccess,
    onError: onActionError,
  }

  return (
    <div>
      <PageHeader
        title=""
        actions={
          <>
            {order.status === 'PENDING' && canTerms && (
              <Button variant="outline" onClick={() => setDialog('terms')}>
                Confirmar frete
              </Button>
            )}
            {order.status === 'PENDING' && order.shipping_confirmed && canPay && (
              <Button onClick={() => setDialog('pay')}>Confirmar pagamento</Button>
            )}
            {order.status === 'PAID' && canShip && (
              <Button onClick={() => setDialog('ship')}>Enviar</Button>
            )}
            {order.status === 'SHIPPED' && canDeliver && (
              <Button onClick={() => setDialog('deliver')}>Marcar entregue</Button>
            )}
            {(order.status === 'SHIPPED' || order.status === 'DELIVERED') && canReturn && (
              <Button variant="outline" onClick={() => setDialog('return')}>
                Devolução
              </Button>
            )}
            {(order.status === 'PENDING' || order.status === 'PAID') && canCancel && (
              <Button variant="destructive" onClick={() => setDialog('cancel')}>
                Cancelar
              </Button>
            )}
          </>
        }
      />
      <div className="-mt-9 mb-5">
        <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
          <Link to="/app/orders">
            <ArrowLeft />
            Voltar aos pedidos
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <CodeChip code={order.code} className="text-sm" />
          <OrderStatusBadge status={order.status} />
          <span className="text-xs text-muted-foreground tabular-nums">
            revisão {order.revision}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Criado em {formatDateTime(order.created_at)}
          {order.paid_at && ` · Pago em ${formatDateTime(order.paid_at)}`}
          {order.shipped_at && ` · Enviado em ${formatDateTime(order.shipped_at)}`}
          {order.delivered_at && ` · Entregue em ${formatDateTime(order.delivered_at)}`}
          {order.cancelled_at && ` · Cancelado em ${formatDateTime(order.cancelled_at)}`}
          {order.returned_at && ` · Devolvido em ${formatDateTime(order.returned_at)}`}
        </p>
      </div>

      {stockWarning && (
        <Alert className="mb-4 border-warning/40 bg-warning/10">
          <AlertTitle>Sem estoque disponível para baixar este pedido</AlertTitle>
          <AlertDescription>
            A reserva pode ter expirado e o estoque foi usado por outro pedido. Registre uma entrada
            de estoque ou cancele o pedido.{' '}
            <Link to="/app/inventory" className="font-medium underline">
              Ir para o estoque
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Coluna principal */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Itens do pedido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.map((item) => {
                const img = productImageUrl(item.image_path)
                return (
                  <div key={item.id} className="flex items-center gap-3">
                    {img ? (
                      <img
                        src={img}
                        alt={item.product_name}
                        className="h-14 w-14 shrink-0 rounded-md border object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
                        sem foto
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.product_name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{item.product_code}</span>
                        {item.attributes_snapshot.length > 0 &&
                          ` · ${item.attributes_snapshot.map((a) => `${a.name}: ${a.value}`).join(' · ')}`}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {item.quantity} × {brl(item.unit_price)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">
                      {brl(item.line_total)}
                    </p>
                  </div>
                )
              })}
              <Separator />
              <div>
                <InfoRow label="Subtotal">{brl(order.subtotal)}</InfoRow>
                <InfoRow label="Frete">
                  {order.shipping_confirmed ? (
                    brl(order.shipping_amount)
                  ) : (
                    <span className="italic text-muted-foreground">a combinar</span>
                  )}
                </InfoRow>
                <Separator className="my-1" />
                <InfoRow label="Total">
                  <span className="font-display text-base">{brl(order.total)}</span>
                </InfoRow>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Histórico</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
              ) : (
                <ol className="relative space-y-4 border-l pl-5">
                  {history.map((h) => (
                    <li key={h.id} className="relative">
                      <span className="absolute -left-[26.5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" />
                      <p className="text-sm font-medium">{ORDER_EVENT_LABELS[h.event_type]}</p>
                      <p className="text-xs text-muted-foreground">
                        {h.status_before
                          ? `${ORDER_STATUS_LABELS[h.status_before]} → ${ORDER_STATUS_LABELS[h.status_after]}`
                          : ORDER_STATUS_LABELS[h.status_after]}
                        {' · '}
                        {formatDateTime(h.created_at)}
                      </p>
                      {h.note && <p className="mt-1 text-sm text-muted-foreground">{h.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Coluna lateral */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cliente e entrega</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium">{order.customer_snapshot.full_name}</p>
                <p className="text-muted-foreground">{order.customer_snapshot.phone}</p>
              </div>
              <div className="text-muted-foreground">
                <p>
                  {addr.street}, {addr.number}
                  {addr.complement ? ` — ${addr.complement}` : ''}
                </p>
                <p>{addr.district}</p>
                <p>
                  {addr.city}/{addr.state} · CEP {cep}
                </p>
              </div>
              {order.customer_note && (
                <div className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Observação do cliente: </span>
                  {order.customer_note}
                </div>
              )}
              <Button asChild variant="outline" size="sm" className="w-full">
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle />
                  Abrir WhatsApp do cliente
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reservas de estoque</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reservations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma reserva.</p>
              ) : (
                reservations.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="tabular-nums">{r.quantity} un</span>
                    <div className="flex items-center gap-2">
                      {r.state === 'HELD' && (
                        <span className="text-xs text-muted-foreground">
                          até {formatDateTime(r.expires_at)}
                        </span>
                      )}
                      <Badge
                        className={
                          r.state === 'HELD'
                            ? 'border-transparent bg-warning/15 text-warning'
                            : r.state === 'CONSUMED'
                              ? 'border-transparent bg-success/10 text-success'
                              : 'border-transparent bg-muted text-muted-foreground'
                        }
                      >
                        {RESERVATION_STATE_LABELS[r.state]}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pagamentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum pagamento registrado.</p>
              ) : (
                payments.map((p) => (
                  <div key={p.id} className="rounded-md border p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        className={
                          p.kind === 'RECEIPT'
                            ? 'border-transparent bg-success/10 text-success'
                            : 'border-transparent bg-destructive/10 text-destructive'
                        }
                      >
                        {p.kind === 'RECEIPT' ? 'Recebimento' : 'Reembolso'}
                      </Badge>
                      <span className="font-semibold tabular-nums">{brl(p.amount)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {PAYMENT_METHOD_LABELS[p.method]} · {formatDateTime(p.confirmed_at)}
                    </p>
                    {p.external_reference && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Ref.: {p.external_reference}
                      </p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {returns.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Devolução</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {returns.map((r) => (
                  <div key={r.id} className="rounded-md border p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {returnByItem.get(r.order_item_id) ?? 'Item'} × {r.quantity}
                      </span>
                      <Badge
                        className={
                          r.disposition === 'RESTOCKED'
                            ? 'border-transparent bg-success/10 text-success'
                            : 'border-transparent bg-destructive/10 text-destructive'
                        }
                      >
                        {RETURN_DISPOSITION_LABELS[r.disposition]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(r.created_at)}
                      {r.disposition === 'DAMAGED' && r.loss_value > 0
                        ? ` · perda de ${brl(r.loss_value)}`
                        : ''}
                      {r.disposition === 'RESTOCKED' && r.restocked_value > 0
                        ? ` · reposto ${brl(r.restocked_value)}`
                        : ''}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <ConfirmTermsDialog {...dialogProps} open={dialog === 'terms'} onOpenChange={(o) => !o && closeDialog()} />
      <ConfirmPaymentDialog {...dialogProps} open={dialog === 'pay'} onOpenChange={(o) => !o && closeDialog()} />
      <ShipDialog {...dialogProps} open={dialog === 'ship'} onOpenChange={(o) => !o && closeDialog()} />
      <DeliverDialog {...dialogProps} open={dialog === 'deliver'} onOpenChange={(o) => !o && closeDialog()} />
      <CancelDialog {...dialogProps} open={dialog === 'cancel'} onOpenChange={(o) => !o && closeDialog()} />
      <ReturnDialog {...dialogProps} open={dialog === 'return'} onOpenChange={(o) => !o && closeDialog()} />
    </div>
  )
}
