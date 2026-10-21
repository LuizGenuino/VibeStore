import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, LayoutGrid, List } from 'lucide-react'
import { ordersService } from '@/services/orders.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { ORDER_STATUS_LABELS } from '@/lib/constants'
import { brl } from '@/lib/money'
import { formatDate, formatDateTime, maskPhone } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { OrderStatus, OrdersRow } from '@/types/backend'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyFilteredState,
  EmptyState,
  ErrorRetryState,
  ForbiddenState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { DataPagination } from '@/components/shared/pagination'
import { CodeChip, OrderStatusBadge } from '@/components/shared/order-status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import OrderManualDialog from './OrderManualDialog'

const PAGE_SIZE = 20
const ALL_STATUSES: OrderStatus[] = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED']
const KANBAN_STATUSES: OrderStatus[] = ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED']

/** Reserva de estoque vencida em pedido ainda pendente (guia 13.2). */
const isReservationExpired = (o: OrdersRow): boolean =>
  o.status === 'PENDING' && !!o.reservation_expires_at && new Date(o.reservation_expires_at) < new Date()

function ReservationExpiredBadge() {
  return (
    <Badge className="border-transparent bg-destructive/10 text-destructive">Reserva expirada</Badge>
  )
}

function StatusFilter({
  value,
  onChange,
}: {
  value: OrderStatus[]
  onChange: (v: OrderStatus[]) => void
}) {
  const toggle = (s: OrderStatus, checked: boolean) =>
    onChange(checked ? [...value, s] : value.filter((v) => v !== s))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="justify-between gap-2">
          Status{value.length > 0 ? ` (${value.length})` : ''}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56">
        <div className="space-y-2">
          {ALL_STATUSES.map((s) => (
            <label key={s} className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={value.includes(s)}
                onCheckedChange={(c) => toggle(s, c === true)}
              />
              {ORDER_STATUS_LABELS[s]}
            </label>
          ))}
        </div>
        {value.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => onChange([])}>
            Limpar status
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Card de pedido no quadro kanban. */
function KanbanCard({ order }: { order: OrdersRow }) {
  return (
    <Link
      to={`/app/orders/${order.id}`}
      className="block rounded-lg border bg-card p-3 shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="flex items-center justify-between gap-2">
        <CodeChip code={order.code} />
        <span className="font-display text-sm font-semibold tabular-nums">{brl(order.total)}</span>
      </div>
      <p className="mt-2 truncate text-sm font-medium">{order.customer_snapshot.full_name}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{formatDate(order.created_at)}</span>
        {!order.shipping_confirmed && <span className="italic">frete a combinar</span>}
      </div>
      {isReservationExpired(order) && (
        <div className="mt-2">
          <ReservationExpiredBadge />
        </div>
      )}
    </Link>
  )
}

function KanbanColumn({ storeId, status }: { storeId: string; status: OrderStatus }) {
  const q = useQuery({
    queryKey: ['orders', storeId, 'kanban', status],
    queryFn: () => ordersService.listOrders(storeId, { status: [status], page: 1, pageSize: 20 }),
  })
  return (
    <div className="flex min-h-40 w-64 shrink-0 flex-col rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm font-semibold">{ORDER_STATUS_LABELS[status]}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {q.data?.total ?? '…'}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {q.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : q.isError ? (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">
            Falha ao carregar.{' '}
            <button className="underline" onClick={() => q.refetch()}>
              Tentar novamente
            </button>
          </p>
        ) : q.data && q.data.items.length > 0 ? (
          <>
            {q.data.items.map((o) => (
              <KanbanCard key={o.id} order={o} />
            ))}
            {q.data.total > q.data.items.length && (
              <p className="px-1 pt-1 text-center text-xs text-muted-foreground">
                Exibindo {q.data.items.length} de {q.data.total} — refine na aba Lista.
              </p>
            )}
          </>
        ) : (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Nenhum pedido {ORDER_STATUS_LABELS[status].toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  )
}

/** /app/orders (guia 13.2) — lista paginada com filtros + quadro kanban. */
export default function OrdersPage() {
  const storeId = useStoreId()
  const canRead = useHasStorePerm('orders.read')
  const navigate = useNavigate()

  const [tab, setTab] = useState<'lista' | 'quadro'>('lista')
  const [statuses, setStatuses] = useState<OrderStatus[]>([])
  const [code, setCode] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const hasFilters = statuses.length > 0 || !!code.trim() || !!from || !!to
  const clearFilters = () => {
    setStatuses([])
    setCode('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const q = useQuery({
    queryKey: ['orders', storeId, 'list', { statuses, code: code.trim(), from, to, page }],
    queryFn: () =>
      ordersService.listOrders(storeId!, {
        status: statuses,
        code: code.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: !!storeId && canRead,
  })

  if (!canRead) return <ForbiddenState />

  return (
    <div>
      <PageHeader
        title="Pedidos"
        description="Acompanhe e opere os pedidos da sua loja."
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'lista' | 'quadro')}>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <TabsList>
            <TabsTrigger value="lista">
              <List />
              Lista
            </TabsTrigger>
            <TabsTrigger value="quadro">
              <LayoutGrid />
              Quadro
            </TabsTrigger>
          </TabsList>
          {tab === 'lista' && (
            <div className="flex flex-wrap items-center gap-2">
              <StatusFilter
                value={statuses}
                onChange={(v) => {
                  setStatuses(v)
                  setPage(1)
                }}
              />
              <Input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value)
                  setPage(1)
                }}
                placeholder="Código (ex.: PED-000123)"
                className="w-52"
                aria-label="Filtrar por código"
              />
              <div className="flex items-center gap-1">
                <Label htmlFor="orders-from" className="sr-only">
                  De
                </Label>
                <Input
                  id="orders-from"
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value)
                    setPage(1)
                  }}
                  className="w-36"
                />
                <span className="text-xs text-muted-foreground">até</span>
                <Label htmlFor="orders-to" className="sr-only">
                  Até
                </Label>
                <Input
                  id="orders-to"
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value)
                    setPage(1)
                  }}
                  className="w-36"
                />
              </div>
            </div>
          )}
          <OrderManualDialog reload={q.refetch} />
        </div>

        <TabsContent value="lista" className="mt-0">
          {q.isLoading ? (
            <TableSkeleton rows={8} cols={7} />
          ) : q.isError ? (
            <ErrorRetryState onRetry={() => q.refetch()} retrying={q.isFetching} />
          ) : q.data && q.data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead className="text-right">Frete</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data.items.map((o) => (
                      <TableRow
                        key={o.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/app/orders/${o.id}`)}
                      >
                        <TableCell>
                          <CodeChip code={o.code} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDateTime(o.created_at)}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {o.customer_snapshot.full_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {maskPhone(o.customer_snapshot.phone)}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <OrderStatusBadge status={o.status} />
                            {isReservationExpired(o) && <ReservationExpiredBadge />}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(o.subtotal)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {o.shipping_confirmed ? (
                            brl(o.shipping_amount)
                          ) : (
                            <span className="text-xs italic text-muted-foreground">a combinar</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {brl(o.total)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <DataPagination
                page={page}
                total={q.data.total}
                pageSize={q.data.pageSize}
                onPage={setPage}
              />
            </>
          ) : hasFilters ? (
            <EmptyFilteredState onClear={clearFilters} />
          ) : (
            <EmptyState
              title="Nenhum pedido ainda"
              description="Os pedidos feitos na sua vitrine aparecem aqui."
            />
          )}
        </TabsContent>

        <TabsContent value="quadro" className="mt-0">
          {storeId && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {KANBAN_STATUSES.map((s) => (
                <KanbanColumn key={s} storeId={storeId} status={s} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
