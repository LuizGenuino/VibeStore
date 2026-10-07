import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { expensesService } from '@/services/expenses.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { EXPENSE_CLASSIFICATION_LABELS } from '@/lib/constants'
import { BackendError } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import type { ExpenseCategoriesRow, ExpenseClassification } from '@/types/backend'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyState,
  ErrorRetryState,
  ForbiddenState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { FormField } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'

const DUPLICATE_NAME = '23505:expense_categories_store_name'
const NAME_RULE = 'Já existe uma categoria com este nome.'

/** Texto de ajuda da classificação (efeito no ERP — guia 15.1). */
const CLASSIFICATION_HELP: Record<ExpenseClassification, string> = {
  OPERATING:
    'Aluguel, internet, embalagens, marketing, taxas… Entra nas despesas operacionais (reduz o resultado) e no caixa.',
  INVENTORY_PURCHASE:
    'Pagamento de mercadoria para estoque. Afeta somente o caixa — o custo entra no resultado via CMV quando vendido, evitando dupla contagem.',
}

/** Dialog de criação — classificação imutável após criar. */
function CreateCategoryDialog({
  storeId,
  open,
  onOpenChange,
  onSaved,
}: {
  storeId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [classification, setClassification] = useState<ExpenseClassification>('OPERATING')
  const [nameError, setNameError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => expensesService.createCategory(storeId, name, classification),
    onSuccess: () => {
      toastSuccess('Categoria criada')
      setName('')
      setClassification('OPERATING')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof BackendError && e.code === DUPLICATE_NAME) {
        setNameError(NAME_RULE)
        return
      }
      toastError(e, 'Não foi possível criar a categoria')
    },
  })

  function submit() {
    if (name.trim().length < 2) {
      setNameError('Informe um nome (mínimo de 2 caracteres).')
      return
    }
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova categoria</DialogTitle>
          <DialogDescription>
            A classificação não pode ser alterada depois — escolha com cuidado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Nome" htmlFor="cat-name" required error={nameError}>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
              }}
              maxLength={100}
              placeholder="Ex.: Aluguel"
            />
          </FormField>
          <FormField label="Classificação" required>
            <RadioGroup
              value={classification}
              onValueChange={(v) => setClassification(v as ExpenseClassification)}
              className="gap-3"
            >
              {(Object.keys(EXPENSE_CLASSIFICATION_LABELS) as ExpenseClassification[]).map((c) => (
                <label
                  key={c}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm font-normal"
                >
                  <RadioGroupItem value={c} id={`cat-cls-${c}`} className="mt-0.5" />
                  <span>
                    <strong>{EXPENSE_CLASSIFICATION_LABELS[c]}</strong>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {CLASSIFICATION_HELP[c]}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={create.isPending || name.trim().length < 2}>
            {create.isPending && <Loader2 className="animate-spin" />}
            Criar categoria
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog de edição — nome e ativação (classificação não aparece: imutável). */
function EditCategoryDialog({
  category,
  open,
  onOpenChange,
  onSaved,
}: {
  category: ExpenseCategoriesRow
  open: boolean
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [name, setName] = useState(category.name)
  const [active, setActive] = useState(category.is_active)
  const [nameError, setNameError] = useState<string | null>(null)

  const update = useMutation({
    mutationFn: () => expensesService.updateCategory(category.id, name, active),
    onSuccess: () => {
      toastSuccess('Categoria atualizada')
      onSaved()
      onOpenChange(false)
    },
    onError: (e) => {
      if (e instanceof BackendError && e.code === DUPLICATE_NAME) {
        setNameError(NAME_RULE)
        return
      }
      toastError(e, messageFor(e instanceof BackendError ? e.code : 'UNKNOWN'))
    },
  })

  function submit() {
    if (name.trim().length < 2) {
      setNameError('Informe um nome (mínimo de 2 caracteres).')
      return
    }
    update.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar categoria</DialogTitle>
          <DialogDescription>
            {EXPENSE_CLASSIFICATION_LABELS[category.classification]} — a classificação não pode ser
            alterada.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Nome" htmlFor="cat-edit-name" required error={nameError}>
            <Input
              id="cat-edit-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(null)
              }}
              maxLength={100}
            />
          </FormField>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              <strong>Categoria ativa</strong>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Categorias inativas não aparecem no formulário de nova despesa. Não há exclusão.
              </span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Categoria ativa" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={update.isPending}>
            Voltar
          </Button>
          <Button onClick={submit} disabled={update.isPending || name.trim().length < 2}>
            {update.isPending && <Loader2 className="animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** /app/expenses/categories (guia 15.1) — categorias agrupadas por classificação. */
export default function ExpenseCategoriesPage() {
  const storeId = useStoreId()
  const canRead = useHasStorePerm('expenses.read')
  const canManage = useHasStorePerm('expenses.categories.manage')
  const qc = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ExpenseCategoriesRow | null>(null)

  const q = useQuery({
    queryKey: ['expenses', storeId, 'categories'],
    queryFn: () => expensesService.listCategories(storeId!),
    enabled: !!storeId && canRead,
  })

  if (!canRead) return <ForbiddenState />

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['expenses', storeId, 'categories'] })
  }

  const groups: ExpenseClassification[] = ['OPERATING', 'INVENTORY_PURCHASE']
  const byClassification = (c: ExpenseClassification) =>
    (q.data ?? []).filter((cat) => cat.classification === c)

  return (
    <div>
      <PageHeader
        title="Categorias de despesa"
        description="Organize seus lançamentos. A classificação define o efeito no ERP e é imutável."
        actions={
          canManage ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus />
              Nova categoria
            </Button>
          ) : undefined
        }
      />

      {q.isLoading ? (
        <TableSkeleton rows={5} cols={3} />
      ) : q.isError ? (
        <ErrorRetryState onRetry={() => q.refetch()} retrying={q.isFetching} />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhuma categoria"
          description="Crie categorias como Aluguel, Marketing ou Compra de estoque para registrar despesas."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus />
                Nova categoria
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g}>
              <CardHeader>
                <CardTitle className="text-base">{EXPENSE_CLASSIFICATION_LABELS[g]}</CardTitle>
                <CardDescription>{CLASSIFICATION_HELP[g]}</CardDescription>
              </CardHeader>
              <CardContent>
                {byClassification(g).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma categoria desta classificação.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {byClassification(g).map((cat) => (
                      <li key={cat.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{cat.name}</span>
                          {!cat.is_active && (
                            <Badge className="border-transparent bg-muted text-muted-foreground">
                              Inativa
                            </Badge>
                          )}
                        </div>
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 shrink-0"
                            onClick={() => setEditTarget(cat)}
                          >
                            <Pencil />
                            Editar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {storeId && (
        <CreateCategoryDialog
          storeId={storeId}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={invalidate}
        />
      )}
      {editTarget && (
        <EditCategoryDialog
          key={editTarget.id}
          category={editTarget}
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  )
}
