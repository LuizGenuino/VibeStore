import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, FolderTree, Pencil, Plus, RefreshCw } from 'lucide-react'
import { catalogService } from '@/services/catalog.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { BackendError } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import { SLUG_RE } from '@/lib/format'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyState,
  ErrorRetryState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { FormField } from '@/components/shared/form'
import { CodeChip } from '@/components/shared/order-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CategoriesRow, CategoryInput, CategoryPatch, Uuid } from '@/types'

// ---------- Formulário (criar / editar) ----------

interface CategoryFormState {
  name: string
  slug: string
  parentId: string | null
  isActive: boolean
  sortOrder: string
}

const EMPTY_FORM: CategoryFormState = {
  name: '',
  slug: '',
  parentId: null,
  isActive: true,
  sortOrder: '0',
}

interface CategoryFormErrors {
  name?: string
  slug?: string
  parentId?: string
  sortOrder?: string
}

function validateForm(form: CategoryFormState): CategoryFormErrors {
  const errors: CategoryFormErrors = {}
  const name = form.name.trim()
  if (name.length < 2 || name.length > 100) errors.name = 'Informe um nome entre 2 e 100 caracteres.'
  const slug = form.slug.trim()
  if (slug && (slug.length < 2 || slug.length > 100 || !SLUG_RE.test(slug)))
    errors.slug = 'Use letras minúsculas, números e hífens (2 a 100 caracteres).'
  const sort = Number(form.sortOrder)
  if (!Number.isInteger(sort) || sort < 0 || sort > 1_000_000)
    errors.sortOrder = 'Ordem deve ser um inteiro entre 0 e 1.000.000.'
  return errors
}

function mapSubmitError(e: unknown, setErrors: (fn: (prev: CategoryFormErrors) => CategoryFormErrors) => void) {
  if (e instanceof BackendError) {
    if (e.code === 'CATEGORY_SLUG_EXISTS' || e.code === '23505:categories_store_slug') {
      setErrors((prev) => ({ ...prev, slug: messageFor('CATEGORY_SLUG_EXISTS') }))
      return true
    }
    if (e.code === 'CATEGORY_PARENT_UNAVAILABLE' || e.code === 'CATEGORY_MAX_TWO_LEVELS') {
      setErrors((prev) => ({ ...prev, parentId: messageFor(e.code) }))
      return true
    }
  }
  return false
}

// ---------- Página ----------

export default function CategoriesPage() {
  const storeId = useStoreId()
  const canManage = useHasStorePerm('catalog.categories.manage')
  const queryClient = useQueryClient()

  const [dialog, setDialog] = useState<
    { mode: 'create'; parentId?: string | null } | { mode: 'edit'; category: CategoriesRow } | null
  >(null)
  const [archiving, setArchiving] = useState<CategoriesRow | null>(null)

  const query = useQuery({
    queryKey: ['catalog', 'categories', storeId],
    queryFn: () => catalogService.listCategories(storeId!),
    enabled: !!storeId,
  })

  const { roots, childrenOf, liveChildrenCount } = useMemo(() => {
    const rows = query.data ?? []
    const childrenMap = new Map<Uuid, CategoriesRow[]>()
    for (const c of rows) {
      if (!c.parent_id) continue
      const list = childrenMap.get(c.parent_id) ?? []
      list.push(c)
      childrenMap.set(c.parent_id, list)
    }
    return {
      roots: rows.filter((c) => !c.parent_id),
      childrenOf: (id: Uuid) => childrenMap.get(id) ?? [],
      liveChildrenCount: (id: Uuid) => (childrenMap.get(id) ?? []).length,
    }
  }, [query.data])

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['catalog', 'categories', storeId] })

  const archiveMutation = useMutation({
    mutationFn: async (category: CategoriesRow) => {
      const products = await catalogService.countProductsInCategory(category.id)
      if (products > 0) throw new BackendError('CATEGORY_HAS_LIVE_PRODUCTS', '')
      await catalogService.archiveCategory(category.id)
    },
    onSuccess: () => {
      toastSuccess('Categoria arquivada')
      setArchiving(null)
      invalidate()
    },
    onError: (e) => {
      toastError(e, 'Não foi possível arquivar')
      if (e instanceof BackendError && e.code === 'CATEGORY_HAS_LIVE_PRODUCTS') setArchiving(null)
    },
  })

  const archivingBlockedByChildren = archiving ? liveChildrenCount(archiving.id) > 0 : false

  return (
    <div>
      <PageHeader
        title="Categorias"
        description="Organize o catálogo em até 2 níveis: categoria e subcategoria."
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <Plus /> Nova categoria
            </Button>
          ) : undefined
        }
      />

      {query.isPending ? (
        <TableSkeleton rows={6} cols={4} />
      ) : query.isError ? (
        <ErrorRetryState onRetry={() => query.refetch()} retrying={query.isRefetching} />
      ) : roots.length === 0 ? (
        <EmptyState
          title="Nenhuma categoria"
          description="Produtos podem ficar sem categoria."
          action={
            canManage ? (
              <Button onClick={() => setDialog({ mode: 'create' })}>
                <Plus /> Criar categoria
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {roots.map((root) => (
            <div key={root.id} className="rounded-lg border bg-card">
              <CategoryRow
                category={root}
                depth={0}
                canManage={canManage}
                onEdit={() => setDialog({ mode: 'edit', category: root })}
                onArchive={() => setArchiving(root)}
                onAddChild={
                  canManage
                    ? () => setDialog({ mode: 'create', parentId: root.id })
                    : undefined
                }
              />
              {childrenOf(root.id).map((child) => (
                <CategoryRow
                  key={child.id}
                  category={child}
                  depth={1}
                  canManage={canManage}
                  onEdit={() => setDialog({ mode: 'edit', category: child })}
                  onArchive={() => setArchiving(child)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {dialog && storeId && (
        <CategoryDialog
          mode={dialog.mode}
          category={dialog.mode === 'edit' ? dialog.category : null}
          initialParentId={dialog.mode === 'create' ? (dialog.parentId ?? null) : null}
          roots={roots}
          storeId={storeId}
          hasChildren={dialog.mode === 'edit' ? liveChildrenCount(dialog.category.id) > 0 : false}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            invalidate()
          }}
        />
      )}

      <AlertDialog open={!!archiving} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar categoria</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingBlockedByChildren
                ? 'Esta categoria tem subcategorias ativas. Arquive ou mova as subcategorias antes.'
                : `"${archiving?.name}" sairá da vitrine e das listagens. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archivingBlockedByChildren || archiveMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (archiving) archiveMutation.mutate(archiving)
              }}
            >
              {archiveMutation.isPending ? 'Arquivando…' : 'Arquivar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- Linha da árvore ----------

function CategoryRow({
  category,
  depth,
  canManage,
  onEdit,
  onArchive,
  onAddChild,
}: {
  category: CategoriesRow
  depth: 0 | 1
  canManage: boolean
  onEdit: () => void
  onArchive: () => void
  onAddChild?: () => void
}) {
  return (
    <div
      className={
        depth === 0
          ? 'flex flex-wrap items-center gap-3 px-4 py-3'
          : 'flex flex-wrap items-center gap-3 border-t bg-muted/30 px-4 py-2.5 pl-10'
      }
    >
      <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={depth === 0 ? 'font-medium' : 'text-sm'}>{category.name}</span>
          <CodeChip code={category.code} />
          {!category.is_active && (
            <Badge className="border-transparent bg-muted text-muted-foreground">
              Oculta da vitrine
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          /{category.slug} · ordem {category.sort_order}
        </p>
      </div>
      {canManage && (
        <div className="flex items-center gap-1">
          {onAddChild && (
            <Button variant="ghost" size="sm" onClick={onAddChild}>
              <Plus /> Subcategoria
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={onArchive}
            aria-label="Arquivar"
          >
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------- Dialog criar/editar ----------

function CategoryDialog({
  mode,
  category,
  initialParentId,
  roots,
  storeId,
  hasChildren,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  category: CategoriesRow | null
  initialParentId: string | null
  roots: CategoriesRow[]
  storeId: Uuid
  hasChildren: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<CategoryFormState>(() =>
    mode === 'edit' && category
      ? {
          name: category.name,
          slug: category.slug,
          parentId: category.parent_id,
          isActive: category.is_active,
          sortOrder: String(category.sort_order),
        }
      : { ...EMPTY_FORM, parentId: initialParentId },
  )
  const [errors, setErrors] = useState<CategoryFormErrors>({})

  // Pai: somente raízes vivas e ≠ da própria categoria.
  const parentOptions = roots.filter((r) => r.id !== category?.id)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const slug = form.slug.trim()
      const sortOrder = Number(form.sortOrder)
      if (mode === 'create') {
        const input: CategoryInput = {
          name: form.name.trim(),
          slug: slug || null,
          parent_id: form.parentId,
          is_active: form.isActive,
          sort_order: sortOrder,
        }
        await catalogService.createCategory(storeId, input)
        return
      }
      // Edição: patch parcial — envia SOMENTE campos alterados.
      const patch: CategoryPatch = {}
      if (category) {
        if (form.name.trim() !== category.name) patch.name = form.name.trim()
        if (slug !== category.slug) patch.slug = slug || null
        if ((form.parentId ?? null) !== (category.parent_id ?? null)) patch.parent_id = form.parentId
        if (form.isActive !== category.is_active) patch.is_active = form.isActive
        if (sortOrder !== category.sort_order) patch.sort_order = sortOrder
      }
      if (Object.keys(patch).length === 0) return
      await catalogService.updateCategory(category!.id, patch)
    },
    onSuccess: () => {
      toastSuccess(mode === 'create' ? 'Categoria criada' : 'Categoria atualizada')
      onSaved()
    },
    onError: (e) => {
      if (!mapSubmitError(e, setErrors)) toastError(e, 'Não foi possível salvar')
    },
  })

  function submit() {
    const next = validateForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    saveMutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Nova categoria' : 'Editar categoria'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Categorias organizam os produtos da vitrine.'
              : 'Somente os campos alterados serão enviados.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FormField label="Nome" htmlFor="cat-name" required error={errors.name}>
            <Input
              id="cat-name"
              value={form.name}
              maxLength={100}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex.: Camisetas"
              autoFocus
            />
          </FormField>

          <FormField
            label="Slug (opcional)"
            htmlFor="cat-slug"
            hint="Endereço da categoria. Deixe vazio para gerar do nome."
            error={errors.slug}
          >
            <Input
              id="cat-slug"
              value={form.slug}
              maxLength={100}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="ex.: camisetas"
              className="font-mono"
            />
          </FormField>

          <FormField
            label="Categoria-mãe"
            hint={
              hasChildren
                ? 'Uma categoria com subcategorias não pode virar subcategoria.'
                : 'Deixe vazio para categoria de primeiro nível.'
            }
            error={errors.parentId}
          >
            <Select
              value={form.parentId ?? 'none'}
              onValueChange={(v) => setForm((f) => ({ ...f, parentId: v === 'none' ? null : v }))}
              disabled={hasChildren}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sem categoria-mãe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem categoria-mãe (raiz)</SelectItem>
                {parentOptions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <div className="flex gap-4">
            <FormField label="Ordem" htmlFor="cat-sort" error={errors.sortOrder} className="w-36">
              <Input
                id="cat-sort"
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                className="tabular-nums"
              />
            </FormField>
            <FormField label="Ativa na vitrine" className="flex-1">
              <div className="flex h-9 items-center">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                />
              </div>
            </FormField>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <RefreshCw className="animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
