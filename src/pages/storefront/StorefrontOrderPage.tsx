import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Link2,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Timer,
  User,
} from 'lucide-react'
import { storefrontApi, StorefrontError } from '@/services/storefront.service'
import { useStorefrontStore } from '@/layouts/StorefrontLayout'
import { orderTokenKey, ORDER_TOKEN_RE } from '@/stores/checkout'
import { ORDER_EVENT_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/constants'
import { formatDateTime, formatPhone } from '@/lib/format'
import { brl } from '@/lib/money'
import { errorMessage } from '@/lib/feedback'
import { productImageUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { CodeChip, OrderStatusBadge } from '@/components/shared/order-status-badge'
import { EmptyState, ErrorRetryState } from '@/components/shared/page-state'

/**
 * Acompanhamento do pedido (guia 19.6): o token chega em #token=… no
 * fragmento (nunca vai ao servidor), é validado, movido para sessionStorage
 * e REMOVIDO da barra de endereço. Vai no body do POST — nunca em query/log.
 * Funciona mesmo com a loja despublicada.
 */
export default function StorefrontOrderPage() {
  const { slug, store } = useStorefrontStore()
  const { orderId = '' } = useParams()

  // Token: fragmento → sessionStorage (e some da URL/histórico).
  const [token, setToken] = useState<string | null>(null)
  const [tokenReady, setTokenReady] = useState(false)

  useEffect(() => {
    // Esta página nunca deve vazar o token via Referer.
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)

    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token')
    if (fromHash && ORDER_TOKEN_RE.test(fromHash)) {
      try {
        sessionStorage.setItem(orderTokenKey(orderId), fromHash)
      } catch {
        /* sem storage: segue com o token em memória */
      }
      // Limpa o token da barra de endereço (não vai em Referer, analytics, prints).
      history.replaceState(history.state, '', window.location.pathname + window.location.search)
    }
    let stored: string | null = null
    try {
      stored = sessionStorage.getItem(orderTokenKey(orderId))
    } catch {
      /* noop */
    }
    const candidate = stored ?? (fromHash && ORDER_TOKEN_RE.test(fromHash) ? fromHash : null)
    setToken(candidate && ORDER_TOKEN_RE.test(candidate) ? candidate : null)
    setTokenReady(true)

    return () => {
      document.head.removeChild(meta)
    }
  }, [orderId])

  const orderQuery = useQuery({
    queryKey: ['storefront', 'order', slug, orderId],
    queryFn: () => storefrontApi.orderStatus(slug, orderId, token as string),
    enabled: tokenReady && !!slug && !!orderId && !!token,
    // Polling de 60 s SOMENTE com a aba visível (o TanStack pausa o intervalo
    // fora de foco, via document.visibilitychange). Limite da Edge: 120/min.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof StorefrontError && (error.notFound || error.status === 400))
        return false
      return failureCount < 2
    },
  })

  // Sem token → orientar a abrir o link completo recebido no WhatsApp.
  if (tokenReady && !token) {
    return (
      <div className="container max-w-xl py-12">
        <EmptyState
          title="Link de acompanhamento necessário"
          description="Abra o link completo recebido no WhatsApp para acompanhar este pedido. Ele contém o código de acesso na própria URL."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={`/s/${slug}`}>Voltar para a loja</Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (!tokenReady || orderQuery.isPending) {
    return (
      <div className="container max-w-3xl space-y-4 py-8" aria-busy="true">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    )
  }

  if (orderQuery.error instanceof StorefrontError && orderQuery.error.notFound) {
    return (
      <div className="container max-w-xl py-12">
        <EmptyState
          title="Pedido não encontrado ou link inválido"
          description="Confira se o link está completo — ele deve terminar com o código de acesso."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={`/s/${slug}`}>Voltar para a loja</Link>
            </Button>
          }
        />
      </div>
    )
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <div className="container max-w-xl py-12">
        <ErrorRetryState
          description={orderQuery.error ? errorMessage(orderQuery.error) : undefined}
          onRetry={() => void orderQuery.refetch()}
          retrying={orderQuery.isRefetching}
        />
      </div>
    )
  }

  const order = orderQuery.data
  const { payment } = order
  const whatsappDigits = (store?.whatsapp_number ?? '').replace(/\D/g, '')
  const whatsappUrl = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(
        `Olá! Quero falar sobre o pedido ${order.code}.`,
      )}`
    : null
  const address = order.address

  return (
    <div className="container max-w-3xl space-y-5 py-8">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold">Pedido</h1>
            <CodeChip code={order.code} className="text-sm" />
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Feito em {formatDateTime(order.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <OrderStatusBadge status={order.status} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void orderQuery.refetch()}
            disabled={orderQuery.isRefetching}
          >
            {orderQuery.isRefetching ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Atualizar
          </Button>
        </div>
      </div>

      {order.status === 'PENDING' && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm',
            order.reservation_active
              ? 'border-warning/50 bg-warning/5 text-foreground'
              : 'border-destructive/50 bg-destructive/5 text-foreground',
          )}
        >
          <Timer className="h-4 w-4 shrink-0" />
          {order.reservation_active
            ? `Reserva de estoque ativa até ${formatDateTime(order.reservation_expires_at)}.`
            : 'A reserva de estoque deste pedido expirou.'}
        </div>
      )}

      {/* Timeline */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 font-display text-base font-semibold">Andamento</h2>
        <ol className="relative space-y-4 border-l pl-5">
          {order.timeline.map((ev, i) => (
            <li key={`${ev.event}-${ev.created_at}-${i}`} className="relative">
              <span
                className={cn(
                  'absolute -left-[26.5px] top-1 h-3 w-3 rounded-full border-2 border-card',
                  i === order.timeline.length - 1 ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
              />
              <p className="text-sm font-medium">{ORDER_EVENT_LABELS[ev.event]}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(ev.created_at)}</p>
            </li>
          ))}
        </ol>
        {order.tracking_code && (
          <p className="mt-4 flex items-center gap-2 text-sm">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            Código de rastreio: <span className="font-mono font-medium">{order.tracking_code}</span>
          </p>
        )}
      </section>

      {/* Itens */}
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 font-display text-base font-semibold">Itens</h2>
        <ul className="divide-y">
          {order.items.map((item, i) => {
            const url = productImageUrl(item.image_path)
            return (
              <li key={`${item.code}-${i}`} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {url && <img src={url} alt={item.name} className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.name}</p>
                  {item.attributes.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {item.attributes.map((a) => `${a.name}: ${a.value}`).join(' · ')}
                    </p>
                  )}
                  <p className="font-mono text-xs text-muted-foreground">
                    {item.quantity} × {brl(item.unit_price)}
                  </p>
                </div>
                <p className="text-sm font-semibold">{brl(item.line_total)}</p>
              </li>
            )
          })}
        </ul>
        <Separator className="my-4" />
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd>{brl(order.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Frete</dt>
            <dd>{order.shipping_confirmed ? brl(order.shipping_amount) : 'A combinar'}</dd>
          </div>
          <div className="flex justify-between pt-1 font-display text-base font-bold">
            <dt>Total</dt>
            <dd>{order.shipping_confirmed ? brl(order.total) : `${brl(order.subtotal)} + frete`}</dd>
          </div>
        </dl>
        <Separator className="my-4" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Pagamento:</span>
          {payment.received ? (
            <Badge className="border-transparent bg-success/10 text-success">
              Recebido{payment.method ? ` via ${PAYMENT_METHOD_LABELS[payment.method]}` : ''}
            </Badge>
          ) : (
            <Badge className="border-transparent bg-muted text-muted-foreground">
              A combinar pelo WhatsApp
            </Badge>
          )}
          {payment.refunded && (
            <Badge className="border-transparent bg-destructive/10 text-destructive">
              Estornado
            </Badge>
          )}
        </div>
      </section>

      {/* Entrega */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold">
            <User className="h-4 w-4 text-muted-foreground" /> Cliente
          </h2>
          <p className="text-sm">{order.customer.full_name}</p>
          <p className="text-sm text-muted-foreground">{formatPhone(order.customer.phone)}</p>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-semibold">
            <MapPin className="h-4 w-4 text-muted-foreground" /> Entrega
          </h2>
          <p className="text-sm">
            {address.street}, {address.number}
            {address.complement ? ` — ${address.complement}` : ''}
          </p>
          <p className="text-sm text-muted-foreground">
            {address.district} · {address.city}/{address.state} · CEP {address.postal_code}
          </p>
        </div>
      </section>

      {order.note && (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="mb-1 font-display text-sm font-semibold">Sua observação</h2>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{order.note}</p>
        </section>
      )}

      {whatsappUrl && (
        <Button asChild variant="whatsapp" size="lg" className="w-full sm:w-fit">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle />
            Chamar no WhatsApp
          </a>
        </Button>
      )}
    </div>
  )
}
