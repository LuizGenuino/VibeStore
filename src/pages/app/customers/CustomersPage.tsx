import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Download, Search } from 'lucide-react'
import { customersService } from '@/services/customers.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { brl } from '@/lib/money'
import { formatDate, formatDateTime, formatPhone } from '@/lib/format'
import { toastError, toastSuccess } from '@/lib/feedback'
import type { CustomersRow, OrderStatus, Uuid } from '@/types/backend'
import { ORDER_STATUS_LABELS } from '@/lib/constants'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyFilteredState,
  EmptyState,
  ErrorRetryState,
  ForbiddenState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { DataPagination } from '@/components/shared/pagination'
import { CodeChip } from '@/components/shared/order-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const PAGE_SIZE = 20

function useDebounced<T>(value: T, delayMs = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}

/** CSV da página carregada (gerado no navegador, sem endpoint — guia 14). */
function exportCsv(rows: CustomersRow[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [
    ['nome', 'telefone', 'cliente_desde'].join(';'),
    ...rows.map((c) => [esc(c.full_name), esc(c.phone), formatDate(c.created_at)].join(';')),
  ]
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Linha expansível: pedidos do cliente + métricas calculadas no cliente (guia 14). */
function CustomerOrders({ customerId }: { customerId: Uuid }) {
  const storeId = useStoreId()
  const canReadOrders = useHasStorePerm('orders.read')
  const q = useQuery({
    queryKey: ['customers', storeId, customerId, 'orders'],
    queryFn: () => customersService.listCustomerOrders(storeId!, customerId),
    enabled: !!storeId,
  })

  if (q.isLoading) {
    return (
      <div className="space-y-2 py-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (q.isError) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        Não foi possível carregar os pedidos.{' '}
        <button className="underline" onClick={() => q.refetch()}>
          Tentar novamente
        </button>
      </p>
    )
  }
  const orders = q.data ?? []
  if (orders.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Nenhum pedido deste cliente.</p>
  }
  // "Total pago": pedidos cujo valor foi recebido (pago, enviado ou entregue).
  const PAID_STATUSES: OrderStatus[] = ['PAID', 'SHIPPED', 'DELIVERED']
  const totalPaid = orders
    .filter((o) => PAID_STATUSES.includes(o.status))
    .reduce((sum, o) => sum + Number(o.total), 0)

  return (
    <div className="space-y-3 py-2">
      <div className="flex flex-wrap gap-6 text-sm">
        <span>
          <span className="text-muted-foreground">Pedidos: </span>
          <strong className="tabular-nums">{orders.length}</strong>
        </span>
        <span>
          <span className="text-muted-foreground">Total pago: </span>
          <strong className="tabular-nums">{brl(totalPaid)}</strong>
        </span>
      </div>
      <ul className="divide-y rounded-md border">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <CodeChip code={o.code} />
            <span className="text-xs text-muted-foreground">{formatDateTime(o.created_at)}</span>
            <span className="text-xs">{ORDER_STATUS_LABELS[o.status]}</span>
            <span className="ml-auto font-medium tabular-nums">{brl(o.total)}</span>
            {canReadOrders && (
              <Button asChild variant="ghost" size="sm" className="h-7">
                <Link to={`/app/orders/${o.id}`}>Ver pedido</Link>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** /app/customers (guia 14) — SOMENTE LEITURA: sem edição, mesclagem ou exclusão. */
export default function CustomersPage() {
  const storeId = useStoreId()
  const canRead = useHasStorePerm('customers.read')

  const [term, setTerm] = useState('')
  const debouncedTerm = useDebounced(term)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Uuid | null>(null)

  useEffect(() => {
    setPage(1)
  }, [debouncedTerm])

  const q = useQuery({
    queryKey: ['customers', storeId, { term: debouncedTerm, page }],
    queryFn: () => customersService.listCustomers(storeId!, debouncedTerm, page, PAGE_SIZE),
    enabled: !!storeId && canRead,
  })

  if (!canRead) return <ForbiddenState />

  const items = q.data?.items ?? []
  const filtered = !!debouncedTerm.trim()

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Criados automaticamente a partir dos pedidos da vitrine (somente leitura)."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={items.length === 0}
            onClick={() => {
              try {
                exportCsv(items)
                toastSuccess('CSV gerado', `${items.length} cliente(s) da página atual exportados.`)
              } catch (e) {
                toastError(e)
              }
            }}
          >
            <Download />
            Exportar CSV
          </Button>
        }
      />

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar por nome ou dígitos do telefone"
          className="pl-8"
          aria-label="Buscar clientes"
        />
      </div>

      {q.isLoading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : q.isError ? (
        <ErrorRetryState onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyFilteredState
            onClear={() => {
              setTerm('')
              setPage(1)
            }}
          />
        ) : (
          <EmptyState
            title="Nenhum cliente ainda"
            description="Quando alguém fizer um pedido na sua vitrine, o cliente aparece aqui."
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Nome</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Cliente desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((c) => {
                  const isOpen = expanded === c.id
                  return (
                    <Fragment key={c.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : c.id)}
                      >
                        <TableCell>
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{c.full_name}</TableCell>
                        <TableCell className="tabular-nums">{formatPhone(c.phone)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(c.created_at)}
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={4} className="px-6">
                            <CustomerOrders customerId={c.id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <DataPagination
            page={page}
            total={q.data!.total}
            pageSize={q.data!.pageSize}
            onPage={setPage}
          />
        </>
      )}
    </div>
  )
}
