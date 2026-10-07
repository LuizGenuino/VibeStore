import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw, Undo2 } from 'lucide-react'
import { inventoryService } from '@/services/inventory.service'
import { catalogService } from '@/services/catalog.service'
import { supabase } from '@/lib/supabase'
import { useHasStorePerm, useMyAccess, useStoreId } from '@/stores/access'
import { toBackendError } from '@/lib/rpc'
import { toastError, toastSuccess } from '@/lib/feedback'
import { formatDateTime, shortId } from '@/lib/format'
import { brl6 } from '@/lib/money'
import { MOVEMENT_TYPE_LABELS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyFilteredState,
  EmptyState,
  ErrorRetryState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { DataPagination } from '@/components/shared/pagination'
import { FormField } from '@/components/shared/form'
import { CodeChip } from '@/components/shared/order-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { InventoryMovementType, InventoryMovementsRow, Uuid } from '@/types'

const PAGE_SIZE = 20
const ALL_TYPES: InventoryMovementType[] = ['ENTRY', 'EXIT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'REVERSAL']

export default function MovementsPage() {
  const storeId = useStoreId()
  const my = useMyAccess()
  const canReverse = useHasStorePerm('inventory.reverse')
  const queryClient = useQueryClient()

  const [productId, setProductId] = useState('')
  const [types, setTypes] = useState<InventoryMovementType[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [reversing, setReversing] = useState<InventoryMovementsRow | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  useEffect(() => {
    setPage(1)
  }, [productId, types, from, to])

  // Produtos da loja para o filtro (pageSize 100).
  const productsQuery = useQuery({
    queryKey: ['catalog', 'products-options', storeId],
    queryFn: () => catalogService.listProducts(storeId!, { page: 1, pageSize: 100 }),
    enabled: !!storeId,
  })

  const filters = {
    productId: productId || undefined,
    types: types.length ? types : undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize: PAGE_SIZE,
  }

  const movementsQuery = useQuery({
    queryKey: ['inventory', 'movements', storeId, filters],
    queryFn: () => inventoryService.listMovements(storeId!, filters),
    enabled: !!storeId,
    placeholderData: keepPreviousData,
  })

  const items = movementsQuery.data?.items ?? []
  const total = movementsQuery.data?.total ?? 0
  const pageIds = useMemo(() => items.map((m) => m.id), [items])
  const pageProductIds = useMemo(() => [...new Set(items.map((m) => m.product_id))], [items])

  // Último movimento por produto (product_stock_balances.last_movement_id) dos produtos da página.
  const lastMovementsQuery = useQuery({
    queryKey: ['inventory', 'last-movements', storeId, pageProductIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_stock_balances')
        .select('product_id, last_movement_id')
        .eq('store_id', storeId!)
        .in('product_id', pageProductIds)
      if (error) throw toBackendError(error)
      return new Map((data ?? []).map((r) => [r.product_id as string, r.last_movement_id as string | null]))
    },
    enabled: !!storeId && canReverse && pageProductIds.length > 0,
  })

  // Elegibilidade de reversão (sem reversão existente e sem vínculo a pedido).
  const eligibilityQuery = useQuery({
    queryKey: ['inventory', 'reversal-eligibility', storeId, pageIds],
    queryFn: () => inventoryService.getReversalEligibility(storeId!, pageIds),
    enabled: !!storeId && canReverse && pageIds.length > 0,
  })

  const canReverseMovement = (m: InventoryMovementsRow): boolean => {
    if (!canReverse) return false
    if (m.movement_type === 'REVERSAL') return false
    if (m.reversal_of_id) return false // já é uma reversão
    const lastId = lastMovementsQuery.data?.get(m.product_id)
    if (!lastId || lastId !== m.id) return false
    return eligibilityQuery.data?.get(m.id) === true
  }

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: Uuid; reason: string }) =>
      inventoryService.reverseMovement(id, reason),
    onSuccess: () => {
      toastSuccess('Movimento revertido')
      setReversing(null)
      setReverseReason('')
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (e) => toastError(e, 'Não foi possível reverter'),
  })

  const hasFilters = !!(productId || types.length || from || to)
  const clearFilters = () => {
    setProductId('')
    setTypes([])
    setFrom('')
    setTo('')
    setPage(1)
  }

  function toggleType(t: InventoryMovementType) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
  }

  return (
    <div>
      <PageHeader
        title="Movimentações de estoque"
        description="Ledger imutável: cada mudança de estoque é uma linha com saldo antes e depois."
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/inventory">
              <ArrowLeft /> Voltar aos saldos
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <FormField label="Produto" className="min-w-56">
          <Select value={productId || 'all'} onValueChange={(v) => setProductId(v === 'all' ? '' : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Todos os produtos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os produtos</SelectItem>
              {(productsQuery.data?.items ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="De">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="Até">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
        <div className="flex flex-wrap items-center gap-3 pb-1">
          {ALL_TYPES.map((t) => (
            <Label key={t} className="flex items-center gap-1.5 text-xs font-normal">
              <Checkbox checked={types.includes(t)} onCheckedChange={() => toggleType(t)} />
              {MOVEMENT_TYPE_LABELS[t]}
            </Label>
          ))}
        </div>
      </div>

      {movementsQuery.isPending ? (
        <TableSkeleton rows={8} cols={8} />
      ) : movementsQuery.isError ? (
        <ErrorRetryState onRetry={() => movementsQuery.refetch()} retrying={movementsQuery.isRefetching} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyFilteredState onClear={clearFilters} />
        ) : (
          <EmptyState
            title="Nenhuma movimentação"
            description="Entradas, saídas, contagens e reversões aparecerão aqui."
            action={
              <Button asChild variant="outline">
                <Link to="/app/inventory">Ir para os saldos</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Custo unit.</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Referência</TableHead>
                  <TableHead>Por</TableHead>
                  {canReverse && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums">
                      {formatDateTime(m.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="max-w-52 truncate text-sm font-medium">{m.product_name}</span>
                        <CodeChip code={m.product_code} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          'border-transparent',
                          m.movement_type === 'ENTRY' || m.movement_type === 'ADJUSTMENT_IN'
                            ? 'bg-success/10 text-success'
                            : m.movement_type === 'REVERSAL'
                              ? 'bg-secondary/10 text-secondary'
                              : 'bg-warning/15 text-warning',
                        )}
                      >
                        {MOVEMENT_TYPE_LABELS[m.movement_type]}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono font-semibold tabular-nums',
                        m.quantity_delta >= 0 ? 'text-success' : 'text-destructive',
                      )}
                    >
                      {m.quantity_delta >= 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.unit_cost != null && Number(m.unit_cost) > 0 ? brl6(m.unit_cost) : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {m.quantity_before} → {m.quantity_after}
                    </TableCell>
                    <TableCell className="max-w-56">
                      <span className="block truncate text-sm" title={m.reason}>
                        {m.reason}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{m.reference ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {m.created_by === my?.user_id ? 'Você' : shortId(m.created_by)}
                    </TableCell>
                    {canReverse && (
                      <TableCell>
                        {canReverseMovement(m) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Reverter movimento"
                            onClick={() => setReversing(m)}
                          >
                            <Undo2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DataPagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}

      <Dialog open={!!reversing} onOpenChange={(open) => !open && setReversing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverter movimento</DialogTitle>
            <DialogDescription>
              Cria um movimento de reversão com o efeito oposto. O movimento original permanece no ledger.
            </DialogDescription>
          </DialogHeader>
          <FormField label="Motivo" required hint="Entre 3 e 500 caracteres.">
            <Input
              value={reverseReason}
              maxLength={500}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Ex.: entrada registrada por engano"
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReversing(null)} disabled={reverseMutation.isPending}>
              Cancelar
            </Button>
            <Button
              disabled={reverseMutation.isPending || reverseReason.trim().length < 3}
              onClick={() => reversing && reverseMutation.mutate({ id: reversing.id, reason: reverseReason })}
            >
              {reverseMutation.isPending && <RefreshCw className="animate-spin" />}
              Reverter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
