import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Undo2 } from 'lucide-react'
import { expensesService } from '@/services/expenses.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import {
  EXPENSE_CLASSIFICATION_LABELS,
  EXPENSE_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/lib/constants'
import { brl } from '@/lib/money'
import { formatDateTime, todayIso } from '@/lib/format'
import { toastError, toastSuccess } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import type {
  ExpenseEntriesRow,
  ExpenseKind,
  ExpenseClassification,
  InventoryMovementsRow,
  ManualMethod,
  Uuid,
} from '@/types/backend'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyFilteredState,
  EmptyState,
  ErrorRetryState,
  ForbiddenState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { DataPagination } from '@/components/shared/pagination'
import { CharCount, FormField } from '@/components/shared/form'
import { MoneyInput } from '@/components/shared/money-input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const PAGE_SIZE = 20
const ALL = '__all__'

type EligiblePurchase = Pick<
  InventoryMovementsRow,
  'id' | 'product_name' | 'quantity_delta' | 'unit_cost' | 'value_delta' | 'reference' | 'created_at'
>

/** datetime-local helpers (fuso local do navegador). */
const pad2 = (n: number) => String(n).padStart(2, '0')
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const nowLocalInput = () => toLocalInput(new Date())
const isoToLocalInput = (iso: string) => toLocalInput(new Date(iso))

const descriptionValid = (d: string) => d.trim().length >= 3 && d.trim().length <= 500

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

/** Dialog "Nova despesa paga" (guia 15.2/15.3). */
function NewExpenseDialog({
  storeId,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: Uuid
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState<number | null>(null)
  const [method, setMethod] = useState<ManualMethod>('PIX')
  const [occurredAt, setOccurredAt] = useState(nowLocalInput())
  const [description, setDescription] = useState('')
  const [descError, setDescError] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [movementId, setMovementId] = useState('')

  const categories = useQuery({
    queryKey: ['expenses', storeId, 'categories'],
    queryFn: () => expensesService.listCategories(storeId),
    enabled: open,
  })
  const activeCategories = (categories.data ?? []).filter((c) => c.is_active)
  const selected = activeCategories.find((c) => c.id === categoryId)
  const isInventoryPurchase = selected?.classification === 'INVENTORY_PURCHASE'

  const eligible = useQuery({
    queryKey: ['expenses', storeId, 'eligible-stock-purchases'],
    queryFn: () => expensesService.listEligibleStockPurchases(storeId),
    enabled: open && isInventoryPurchase,
  })
  const eligibleItems = (eligible.data ?? []) as EligiblePurchase[]

  const save = useMutation({
    mutationFn: () =>
      expensesService.recordExpense({
        storeId,
        categoryId,
        amount: amount!,
        method,
        description: description.trim(),
        occurredAtLocal: occurredAt,
        reference: reference.trim() || undefined,
        inventoryMovementId: isInventoryPurchase && movementId ? movementId : null,
      }),
    onSuccess: () => {
      toastSuccess('Despesa registrada')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => toastError(e, 'Não foi possível registrar a despesa'),
  })

  function submit() {
    if (!categoryId || amount == null || amount <= 0 || !occurredAt) return
    if (!descriptionValid(description)) {
      setDescError('Informe uma descrição (3 a 500 caracteres).')
      return
    }
    save.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova despesa paga</DialogTitle>
          <DialogDescription>
            Registre somente valores já pagos — não existe agendamento nem contas a pagar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {categories.isSuccess && activeCategories.length === 0 ? (
            <Alert>
              <AlertTitle>Nenhuma categoria ativa</AlertTitle>
              <AlertDescription>
                Crie uma categoria antes de registrar despesas.{' '}
                <Link to="/app/expenses/categories" className="font-medium underline">
                  Ir para categorias
                </Link>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <FormField
                label="Categoria"
                htmlFor="exp-category"
                required
                hint="Compra de estoque afeta só o caixa: o custo entra no resultado via CMV quando a mercadoria é vendida."
              >
                <Select
                  value={categoryId}
                  onValueChange={(v) => {
                    setCategoryId(v)
                    setMovementId('')
                  }}
                >
                  <SelectTrigger id="exp-category">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {EXPENSE_CLASSIFICATION_LABELS[c.classification]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Valor" htmlFor="exp-amount" required>
                <MoneyInput id="exp-amount" value={amount} onChange={setAmount} allowNull />
              </FormField>
              <FormField label="Forma de pagamento" htmlFor="exp-method" required>
                <MethodSelect id="exp-method" value={method} onChange={setMethod} />
              </FormField>
              <FormField label="Data do pagamento" htmlFor="exp-date" required hint="Não aceita data futura.">
                <Input
                  id="exp-date"
                  type="datetime-local"
                  value={occurredAt}
                  max={nowLocalInput()}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </FormField>
              <FormField label="Descrição" htmlFor="exp-desc" required error={descError}>
                <Textarea
                  id="exp-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Ex.: aluguel da loja — novembro"
                />
                <div className="flex justify-end">
                  <CharCount value={description} max={500} />
                </div>
              </FormField>
              <FormField label="Referência" htmlFor="exp-ref" hint="NF, comprovante… (opcional, até 160)">
                <Input
                  id="exp-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.slice(0, 160))}
                  maxLength={160}
                />
              </FormField>
              {isInventoryPurchase && (
                <FormField
                  label="Entrada de estoque vinculada"
                  htmlFor="exp-movement"
                  hint="Opcional. Vincula esta despesa a uma entrada manual de estoque ainda não vinculada."
                >
                  {eligible.isLoading ? (
                    <p className="text-sm text-muted-foreground">Carregando entradas…</p>
                  ) : (
                    <Select value={movementId || ALL} onValueChange={(v) => setMovementId(v === ALL ? '' : v)}>
                      <SelectTrigger id="exp-movement">
                        <SelectValue placeholder="Nenhuma" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>Nenhuma</SelectItem>
                        {eligibleItems.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.product_name} — {m.quantity_delta} un · {brl(m.value_delta)} ·{' '}
                            {formatDateTime(m.created_at)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Voltar
          </Button>
          <Button
            onClick={submit}
            disabled={
              save.isPending ||
              activeCategories.length === 0 ||
              !categoryId ||
              amount == null ||
              amount <= 0 ||
              !occurredAt
            }
          >
            {save.isPending && <Loader2 className="animate-spin" />}
            Registrar despesa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog "Estornar" (guia 15.4): CORRECTION (data original) ou REFUND (nova data). */
function ReverseDialog({
  entry,
  open,
  onOpenChange,
  onSaved,
}: {
  entry: ExpenseEntriesRow
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [kind, setKind] = useState<'CORRECTION' | 'REFUND'>('CORRECTION')
  const [description, setDescription] = useState('')
  const [descError, setDescError] = useState<string | null>(null)
  const [occurredAt, setOccurredAt] = useState(nowLocalInput())
  const [method, setMethod] = useState<ManualMethod>('PIX')
  const [reference, setReference] = useState('')

  const save = useMutation({
    mutationFn: () =>
      expensesService.reverseExpense({
        expenseId: entry.id,
        kind,
        description: description.trim(),
        occurredAtLocal: kind === 'REFUND' ? occurredAt : undefined,
        method: kind === 'REFUND' ? method : undefined,
        reference: kind === 'REFUND' ? reference.trim() || undefined : undefined,
      }),
    onSuccess: () => {
      toastSuccess(kind === 'CORRECTION' ? 'Despesa corrigida' : 'Reembolso registrado')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => toastError(e, 'Não foi possível estornar'),
  })

  function submit() {
    if (!descriptionValid(description)) {
      setDescError('Informe uma descrição (3 a 500 caracteres).')
      return
    }
    if (kind === 'REFUND') {
      if (!occurredAt) return
      const ts = new Date(occurredAt).getTime()
      if (Number.isNaN(ts) || ts < new Date(entry.occurred_at).getTime() || ts > Date.now()) return
    }
    save.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Estornar despesa</DialogTitle>
          <DialogDescription>
            {entry.category_name_snapshot} · {brl(entry.amount)} · {formatDateTime(entry.occurred_at)}.
            O estorno reverte o valor integral e só pode ser feito uma vez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Tipo de estorno" required>
            <RadioGroup value={kind} onValueChange={(v) => setKind(v as 'CORRECTION' | 'REFUND')} className="gap-3">
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm font-normal">
                <RadioGroupItem value="CORRECTION" id="rev-correction" className="mt-0.5" />
                <span>
                  <strong>Correção</strong> — o lançamento foi um erro (valor, categoria ou duplicado).
                  Anula na data original, dentro do mesmo período.
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm font-normal">
                <RadioGroupItem value="REFUND" id="rev-refund" className="mt-0.5" />
                <span>
                  <strong>Reembolso</strong> — o fornecedor devolveu o dinheiro de fato. Usa uma nova
                  data (entre a despesa original e agora).
                </span>
              </label>
            </RadioGroup>
          </FormField>
          {kind === 'REFUND' && (
            <>
              <FormField label="Data do reembolso" htmlFor="rev-date" required>
                <Input
                  id="rev-date"
                  type="datetime-local"
                  value={occurredAt}
                  min={isoToLocalInput(entry.occurred_at)}
                  max={nowLocalInput()}
                  onChange={(e) => setOccurredAt(e.target.value)}
                />
              </FormField>
              <FormField label="Forma do reembolso" htmlFor="rev-method" required>
                <MethodSelect id="rev-method" value={method} onChange={setMethod} />
              </FormField>
              <FormField label="Referência" htmlFor="rev-ref" hint="Comprovante… (opcional, até 160)">
                <Input
                  id="rev-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value.slice(0, 160))}
                  maxLength={160}
                />
              </FormField>
            </>
          )}
          <FormField label="Descrição" htmlFor="rev-desc" required error={descError}>
            <Textarea
              id="rev-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={
                kind === 'CORRECTION'
                  ? 'Ex.: lançamento duplicado'
                  : 'Ex.: fornecedor devolveu o valor via Pix'
              }
            />
            <div className="flex justify-end">
              <CharCount value={description} max={500} />
            </div>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Confirmar estorno
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** /app/expenses (guia 15.2/15.3/15.4) — lançamentos de despesas pagas. */
export default function ExpensesPage() {
  const storeId = useStoreId()
  const canRead = useHasStorePerm('expenses.read')
  const canRecord = useHasStorePerm('expenses.record')
  const canReverse = useHasStorePerm('expenses.reverse')
  const qc = useQueryClient()

  const monthStart = useMemo(() => `${todayIso().slice(0, 8)}01`, [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(todayIso())
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState<ExpenseKind | ''>('')
  const [page, setPage] = useState(1)
  const [newOpen, setNewOpen] = useState(false)
  const [reverseTarget, setReverseTarget] = useState<ExpenseEntriesRow | null>(null)

  const hasFilters = categoryId !== '' || kind !== '' || from !== monthStart || to !== todayIso()

  const categories = useQuery({
    queryKey: ['expenses', storeId, 'categories'],
    queryFn: () => expensesService.listCategories(storeId!),
    enabled: !!storeId && canRead,
  })

  const q = useQuery({
    queryKey: ['expenses', storeId, 'entries', { from, to, categoryId, kind, page }],
    queryFn: () =>
      expensesService.listEntries(storeId!, {
        from,
        to,
        categoryId: categoryId || null,
        kind,
        page,
        pageSize: PAGE_SIZE,
      }),
    enabled: !!storeId && canRead && !!from && !!to,
  })

  const ids = useMemo(() => (q.data?.items ?? []).map((e) => e.id), [q.data])
  const reversed = useQuery({
    queryKey: ['expenses', storeId, 'reversed', ids],
    queryFn: () => expensesService.getReversedIds(storeId!, ids),
    enabled: !!storeId && ids.length > 0,
  })
  const reversedIds = reversed.data ?? new Set<Uuid>()

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['expenses', storeId] })
  }

  if (!canRead) return <ForbiddenState />

  const items = q.data?.items ?? []

  return (
    <div>
      <PageHeader
        title="Despesas"
        description="Somente valores já pagos — base de caixa."
        actions={
          canRecord ? (
            <Button onClick={() => setNewOpen(true)}>
              <Plus />
              Nova despesa paga
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="exp-from" className="sr-only">
            De
          </Label>
          <Input
            id="exp-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            className="w-36"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Label htmlFor="exp-to" className="sr-only">
            Até
          </Label>
          <Input
            id="exp-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            className="w-36"
          />
        </div>
        <Select
          value={categoryId || ALL}
          onValueChange={(v) => {
            setCategoryId(v === ALL ? '' : v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-56" aria-label="Categoria">
            <SelectValue placeholder="Todas as categorias" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as categorias</SelectItem>
            {(categories.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={kind || ALL}
          onValueChange={(v) => {
            setKind(v === ALL ? '' : (v as ExpenseKind))
            setPage(1)
          }}
        >
          <SelectTrigger className="w-44" aria-label="Tipo">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os tipos</SelectItem>
            {(Object.keys(EXPENSE_KIND_LABELS) as ExpenseKind[]).map((k) => (
              <SelectItem key={k} value={k}>
                {EXPENSE_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {q.isLoading ? (
        <TableSkeleton rows={8} cols={7} />
      ) : q.isError ? (
        <ErrorRetryState onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyFilteredState
            onClear={() => {
              setFrom(monthStart)
              setTo(todayIso())
              setCategoryId('')
              setKind('')
              setPage(1)
            }}
          />
        ) : (
          <EmptyState
            title="Nenhuma despesa no período"
            description="Registre os pagamentos de despesas para acompanhar seu resultado."
            action={
              canRecord ? (
                <Button size="sm" onClick={() => setNewOpen(true)}>
                  <Plus />
                  Nova despesa paga
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data do pagamento</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Referência</TableHead>
                  {canReverse && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => {
                  const isReversal = e.kind !== 'EXPENSE'
                  const isReversed = reversedIds.has(e.id)
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(e.occurred_at)}
                      </TableCell>
                      <TableCell className="text-sm">{e.category_name_snapshot}</TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {EXPENSE_CLASSIFICATION_LABELS[e.classification]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            className={cn(
                              'border-transparent',
                              e.kind === 'EXPENSE'
                                ? 'bg-muted text-muted-foreground'
                                : e.kind === 'CORRECTION'
                                  ? 'bg-warning/15 text-warning'
                                  : 'bg-secondary/10 text-secondary',
                            )}
                          >
                            {EXPENSE_KIND_LABELS[e.kind]}
                          </Badge>
                          {isReversed && (
                            <Badge className="border-transparent bg-destructive/10 text-destructive">
                              Estornada
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums',
                          isReversal ? 'text-destructive' : 'font-medium',
                        )}
                      >
                        {isReversal ? `−${brl(e.amount)}` : brl(e.amount)}
                      </TableCell>
                      <TableCell className="text-sm">{PAYMENT_METHOD_LABELS[e.method]}</TableCell>
                      <TableCell className="max-w-56">
                        <span className="line-clamp-2 text-sm">{e.description}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.external_reference ?? '—'}
                      </TableCell>
                      {canReverse && (
                        <TableCell>
                          {e.kind === 'EXPENSE' && !isReversed && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setReverseTarget(e)}
                            >
                              <Undo2 />
                              Estornar
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
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

      {storeId && (
        <NewExpenseDialog
          storeId={storeId}
          open={newOpen}
          onOpenChange={setNewOpen}
          onSaved={invalidate}
        />
      )}
      {reverseTarget && (
        <ReverseDialog
          entry={reverseTarget}
          open={!!reverseTarget}
          onOpenChange={(o) => !o && setReverseTarget(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
