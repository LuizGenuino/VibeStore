import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Boxes,
  ClipboardList,
  History,
  Minus,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  Wallet,
} from 'lucide-react'
import { inventoryService } from '@/services/inventory.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { BackendError } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import { brl, brl6, parseQty } from '@/lib/money'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyFilteredState,
  EmptyState,
  ErrorRetryState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { DataPagination } from '@/components/shared/pagination'
import { KpiCard } from '@/components/shared/kpi-card'
import { FormField } from '@/components/shared/form'
import { MoneyInput } from '@/components/shared/money-input'
import { CodeChip, ProductStatusBadge } from '@/components/shared/order-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import type { AdjustBatchItem, ProductStockBalancesRow, Uuid } from '@/types'

const PAGE_SIZE = 20

type Balance = ProductStockBalancesRow

const num = (v: number | null | undefined): number => v ?? 0

export default function InventoryPage() {
  const storeId = useStoreId()
  const canEntry = useHasStorePerm('inventory.entry')
  const canExit = useHasStorePerm('inventory.exit')
  const canAdjust = useHasStorePerm('inventory.adjust')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [onlyZero, setOnlyZero] = useState(false)
  const [onlyReserved, setOnlyReserved] = useState(false)
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE' | ''>('')
  const [page, setPage] = useState(1)

  const [movementDialog, setMovementDialog] = useState<{
    type: 'ENTRY' | 'EXIT'
    row: Balance
  } | null>(null)
  const [countDialog, setCountDialog] = useState<Balance | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, onlyZero, onlyReserved, status])

  const filters = {
    search: debouncedSearch || undefined,
    onlyZero: onlyZero || undefined,
    onlyReserved: onlyReserved || undefined,
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  }

  const balancesQuery = useQuery({
    queryKey: ['inventory', 'balances', storeId, filters],
    queryFn: () => inventoryService.listBalances(storeId!, filters),
    enabled: !!storeId,
    placeholderData: keepPreviousData,
  })

  // Resumo agregado: query separada com página grande (sem filtros).
  const summaryQuery = useQuery({
    queryKey: ['inventory', 'balances-summary', storeId],
    queryFn: () => inventoryService.listBalances(storeId!, { page: 1, pageSize: 1000 }),
    enabled: !!storeId,
  })
  const summary = useMemo(() => {
    const rows = summaryQuery.data?.items ?? []
    return {
      skus: summaryQuery.data?.total ?? 0,
      units: rows.reduce((acc, r) => acc + num(r.quantity), 0),
      value: rows.reduce((acc, r) => acc + num(r.stock_value), 0),
      reserved: rows.reduce((acc, r) => acc + num(r.reserved_quantity), 0),
    }
  }, [summaryQuery.data])

  const items = balancesQuery.data?.items ?? []
  const total = balancesQuery.data?.total ?? 0
  const hasFilters = !!(debouncedSearch || onlyZero || onlyReserved || status)
  const clearFilters = () => {
    setSearch('')
    setDebouncedSearch('')
    setOnlyZero(false)
    setOnlyReserved(false)
    setStatus('')
    setPage(1)
  }

  return (
    <div>
      <PageHeader
        title="Estoque"
        description="Saldos por produto. Reserva não é baixa: a baixa física acontece no pagamento do pedido."
        actions={
          <>
            {canAdjust && (
              <Button variant="outline" onClick={() => setBatchOpen(true)}>
                <ClipboardList /> Contagem em lote
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/app/inventory/movements">
                <History /> Movimentações
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="SKUs" value={String(summary.skus)} icon={Boxes} />
        <KpiCard label="Unidades em estoque" value={summary.units.toLocaleString('pt-BR')} icon={PackageSearch} />
        <KpiCard label="Valor em estoque" value={brl(summary.value)} icon={Wallet} />
        <KpiCard
          label="Reservado (pedidos pendentes)"
          value={summary.reserved.toLocaleString('pt-BR')}
          icon={History}
          tone={summary.reserved > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por produto…"
            className="pl-8"
          />
        </div>
        <Select
          value={status || 'all'}
          onValueChange={(v) => setStatus(v === 'all' ? '' : (v as 'ACTIVE' | 'INACTIVE'))}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="ACTIVE">Ativo</SelectItem>
            <SelectItem value="INACTIVE">Inativo</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyZero} onCheckedChange={(v) => setOnlyZero(v === true)} />
          Zerados
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyReserved} onCheckedChange={(v) => setOnlyReserved(v === true)} />
          Com reservas
        </label>
      </div>

      {balancesQuery.isPending ? (
        <TableSkeleton rows={8} cols={7} />
      ) : balancesQuery.isError ? (
        <ErrorRetryState onRetry={() => balancesQuery.refetch()} retrying={balancesQuery.isRefetching} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyFilteredState onClear={clearFilters} />
        ) : (
          <EmptyState
            title="Nenhum produto no estoque"
            description="Cadastre produtos no catálogo para acompanhar os saldos aqui."
            action={
              <Button asChild>
                <Link to="/app/catalog/products">
                  <Plus /> Ir para o catálogo
                </Link>
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
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Físico</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Custo médio</TableHead>
                  <TableHead className="text-right">Valor em estoque</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((row) => {
                  const available = num(row.available_quantity)
                  return (
                    <TableRow key={row.product_id ?? row.code ?? ''}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{row.name ?? '—'}</span>
                          <span className="flex items-center gap-2">
                            {row.code && <CodeChip code={row.code} />}
                            {row.status && <ProductStatusBadge status={row.status} />}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{num(row.quantity)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {num(row.reserved_quantity)}
                      </TableCell>
                      <TableCell
                        className={
                          available <= 0
                            ? 'text-right font-mono font-semibold tabular-nums text-destructive'
                            : 'text-right font-mono font-semibold tabular-nums text-success'
                        }
                      >
                        {available}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl6(row.average_cost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(row.stock_value)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canEntry && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setMovementDialog({ type: 'ENTRY', row })}
                            >
                              <Plus /> Entrada
                            </Button>
                          )}
                          {canExit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={available <= 0}
                              onClick={() => setMovementDialog({ type: 'EXIT', row })}
                            >
                              <Minus /> Saída
                            </Button>
                          )}
                          {canAdjust && (
                            <Button variant="ghost" size="sm" onClick={() => setCountDialog(row)}>
                              <ClipboardList /> Contagem
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <DataPagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
        </>
      )}

      {movementDialog && (
        <MovementDialog
          type={movementDialog.type}
          row={movementDialog.row}
          onClose={() => setMovementDialog(null)}
        />
      )}
      {countDialog && <CountDialog row={countDialog} onClose={() => setCountDialog(null)} />}
      {batchOpen && storeId && <BatchCountDialog storeId={storeId} onClose={() => setBatchOpen(false)} />}
    </div>
  )
}

// ---------- Dialog Entrada / Saída ----------

function MovementDialog({ type, row, onClose }: { type: 'ENTRY' | 'EXIT'; row: Balance; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const isEntry = type === 'ENTRY'
  const available = num(row.available_quantity)

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.registerMovement({
        productId: row.product_id!,
        type,
        quantity: Number(qty),
        unitCost: isEntry ? unitCost : null,
        reason,
        reference: reference || null,
      }),
    onSuccess: () => {
      toastSuccess(isEntry ? 'Entrada registrada' : 'Saída registrada')
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
    onError: (e) => toastError(e, 'Não foi possível registrar'),
  })

  function submit() {
    setFieldError(null)
    const q = parseQty(qty)
    if (q == null || q < 1) {
      setFieldError(messageFor('QUANTITY_MUST_BE_POSITIVE_INTEGER'))
      return
    }
    if (!isEntry && q > available) {
      setFieldError(`A saída não pode ser maior que o disponível (${available}).`)
      return
    }
    if (isEntry && (unitCost == null || unitCost < 0)) {
      setFieldError(messageFor('INVALID_UNIT_COST'))
      return
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setFieldError('O motivo deve ter entre 3 e 500 caracteres.')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEntry ? 'Entrada de estoque' : 'Saída manual'}</DialogTitle>
          <DialogDescription>
            {row.name} · saldo físico {num(row.quantity)}, disponível {available}.
          </DialogDescription>
        </DialogHeader>

        {!isEntry && (
          <Alert>
            <AlertTitle>Saída não classificada</AlertTitle>
            <AlertDescription>
              Uma saída manual não é venda: aparecerá como saída não classificada nos relatórios.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <FormField label="Quantidade" required>
            <Input
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="tabular-nums"
              autoFocus
            />
          </FormField>
          {isEntry && (
            <FormField label="Custo unitário" required hint="Obrigatório na entrada; atualiza o custo médio.">
              <MoneyInput value={unitCost} onChange={setUnitCost} />
            </FormField>
          )}
          <FormField label="Motivo" required hint="Entre 3 e 500 caracteres.">
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <FormField label="Referência (opcional)" hint={isEntry ? 'Ex.: número da nota fiscal.' : undefined}>
            <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </FormField>
          {fieldError && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {fieldError}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending && <RefreshCw className="animate-spin" />}
            {isEntry ? 'Registrar entrada' : 'Registrar saída'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Dialog Contagem ----------

function CountDialog({ row, onClose }: { row: Balance; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [counted, setCounted] = useState('')
  const [unitCost, setUnitCost] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const currentQty = num(row.quantity)
  const countedNum = parseQty(counted)
  const increases = countedNum != null && countedNum > currentQty

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.adjustCount({
        productId: row.product_id!,
        countedQuantity: countedNum!,
        expectedRevision: num(row.revision),
        reason,
        unitCost: increases ? unitCost : null,
        currentQuantity: currentQty,
        reference: reference || null,
      }),
    onSuccess: (r) => {
      toastSuccess(r.changed ? 'Contagem registrada' : 'Saldo já estava correto')
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
    onError: (e) => {
      if (e instanceof BackendError && e.code === 'STALE_INVENTORY_REVISION') {
        toastError(e, 'O estoque mudou, recarregamos')
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
        onClose()
        return
      }
      toastError(e, 'Não foi possível registrar a contagem')
    },
  })

  function submit() {
    setFieldError(null)
    if (countedNum == null) {
      setFieldError('Informe a quantidade contada (inteiro maior ou igual a zero).')
      return
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setFieldError('O motivo deve ter entre 3 e 500 caracteres.')
      return
    }
    if (increases && (unitCost == null || unitCost < 0)) {
      setFieldError(messageFor('INVALID_UNIT_COST'))
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contagem de estoque</DialogTitle>
          <DialogDescription>
            {row.name} · saldo atual no sistema: {currentQty}. Informe a quantidade ABSOLUTA contada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Quantidade contada" required>
            <Input
              inputMode="numeric"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="tabular-nums"
              autoFocus
            />
          </FormField>
          {increases && (
            <FormField
              label="Custo unitário"
              required
              hint="Obrigatório porque a contagem aumenta o saldo (entra no custo médio)."
            >
              <MoneyInput value={unitCost} onChange={setUnitCost} />
            </FormField>
          )}
          <FormField label="Motivo" required hint="Entre 3 e 500 caracteres.">
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <FormField label="Referência (opcional)">
            <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </FormField>
          {fieldError && (
            <p className="text-xs font-medium text-destructive" role="alert">
              {fieldError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending && <RefreshCw className="animate-spin" />}
            Registrar contagem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Dialog Contagem em lote ----------

interface BatchRowState {
  counted: string
  unitCost: number | null
}

function BatchCountDialog({ storeId, onClose }: { storeId: Uuid; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [edits, setEdits] = useState<Map<string, BatchRowState>>(new Map())
  const [fieldError, setFieldError] = useState<string | null>(null)

  const balancesQuery = useQuery({
    queryKey: ['inventory', 'balances-batch', storeId],
    queryFn: () => inventoryService.listBalances(storeId, { page: 1, pageSize: 50 }),
    enabled: !!storeId,
  })
  const rows = balancesQuery.data?.items ?? []

  const changedItems: AdjustBatchItem[] = useMemo(() => {
    const items: AdjustBatchItem[] = []
    for (const row of rows) {
      const pid = row.product_id
      if (!pid) continue
      const edit = edits.get(pid)
      if (!edit) continue
      const counted = parseQty(edit.counted)
      if (counted == null || counted === num(row.quantity)) continue
      items.push({
        product_id: pid,
        counted_quantity: counted,
        expected_revision: num(row.revision),
        ...(counted > num(row.quantity) && edit.unitCost != null ? { unit_cost: edit.unitCost } : {}),
      })
    }
    return items
  }, [rows, edits])

  const mutation = useMutation({
    mutationFn: () => inventoryService.adjustBatch(storeId, reason, changedItems, reference || undefined),
    onSuccess: (r) => {
      toastSuccess(
        'Contagem em lote registrada',
        r.replayed ? undefined : `${r.items.length} produto(s) processados de forma atômica.`,
      )
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      onClose()
    },
    onError: (e) => {
      if (e instanceof BackendError && e.code === 'STALE_INVENTORY_REVISION') {
        toastError(e, 'O estoque mudou, recarregamos')
        queryClient.invalidateQueries({ queryKey: ['inventory'] })
        onClose()
        return
      }
      toastError(e, 'Não foi possível registrar o lote')
    },
  })

  function setEdit(pid: string, patch: Partial<BatchRowState>) {
    setEdits((prev) => {
      const next = new Map(prev)
      const cur = next.get(pid) ?? { counted: '', unitCost: null }
      next.set(pid, { ...cur, ...patch })
      return next
    })
  }

  function submit() {
    setFieldError(null)
    if (changedItems.length === 0) {
      setFieldError('Nenhuma linha alterada. Informe ao menos uma contagem diferente do saldo.')
      return
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setFieldError('O motivo deve ter entre 3 e 500 caracteres.')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Contagem em lote</DialogTitle>
          <DialogDescription>
            Até 50 produtos por lote, aplicado de forma atômica: um erro desfaz todas as linhas.
          </DialogDescription>
        </DialogHeader>

        {balancesQuery.isPending ? (
          <TableSkeleton rows={6} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhum produto" description="Cadastre produtos para fazer a contagem em lote." />
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-20 text-right">Saldo</TableHead>
                  <TableHead className="w-28">Contado</TableHead>
                  <TableHead className="w-32">Custo (se aumentar)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const pid = row.product_id
                  if (!pid) return null
                  const edit = edits.get(pid)
                  const countedNum = parseQty(edit?.counted ?? '')
                  const increases = countedNum != null && countedNum > num(row.quantity)
                  const changed = countedNum != null && countedNum !== num(row.quantity)
                  return (
                    <TableRow key={pid} className={changed ? 'bg-primary/5' : undefined}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{row.name ?? '—'}</span>
                          {row.code && <CodeChip code={row.code} />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{num(row.quantity)}</TableCell>
                      <TableCell>
                        <Input
                          inputMode="numeric"
                          value={edit?.counted ?? ''}
                          placeholder={String(num(row.quantity))}
                          className="h-8 tabular-nums"
                          onChange={(e) => setEdit(pid, { counted: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        {increases ? (
                          <MoneyInput
                            value={edit?.unitCost ?? null}
                            onChange={(v) => setEdit(pid, { unitCost: v })}
                            className="h-8"
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Motivo" required hint="Entre 3 e 500 caracteres.">
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <FormField label="Referência (opcional)" hint="Ex.: INV-2026-10.">
            <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
          </FormField>
        </div>
        {fieldError && (
          <p className="text-xs font-medium text-destructive" role="alert">
            {fieldError}
          </p>
        )}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">
            {changedItems.length} linha(s) alterada(s)
          </span>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending || changedItems.length === 0}>
            {mutation.isPending && <RefreshCw className="animate-spin" />}
            Aplicar lote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
