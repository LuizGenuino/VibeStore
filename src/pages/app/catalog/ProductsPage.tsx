import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ImageOff, Pencil, Plus, Search, Star } from 'lucide-react'
import { catalogService } from '@/services/catalog.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { toastError, toastSuccess } from '@/lib/feedback'
import { brl } from '@/lib/money'
import { productImageUrl } from '@/lib/media'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyFilteredState,
  EmptyState,
  ErrorRetryState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { DataPagination } from '@/components/shared/pagination'
import { CodeChip, ProductStatusBadge } from '@/components/shared/order-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { ProductStatus } from '@/types'

const PAGE_SIZE = 20

export default function ProductsPage() {
  const storeId = useStoreId()
  const canManage = useHasStorePerm('catalog.products.manage')
  const canReadStock = useHasStorePerm('inventory.read')
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [status, setStatus] = useState<ProductStatus | ''>('')
  const [featured, setFeatured] = useState(false)
  const [page, setPage] = useState(1)
  const [archiving, setArchiving] = useState<string | null>(null) // productId

  // Debounce de 300ms na busca.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Filtros mudaram → volta para a página 1.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, categoryId, status, featured])

  const categoriesQuery = useQuery({
    queryKey: ['catalog', 'categories', storeId],
    queryFn: () => catalogService.listCategories(storeId!),
    enabled: !!storeId,
  })

  const filters = {
    search: debouncedSearch || undefined,
    categoryId: categoryId || undefined,
    status: status || undefined,
    featured: featured || undefined,
    page,
    pageSize: PAGE_SIZE,
  }

  const productsQuery = useQuery({
    queryKey: ['catalog', 'products', storeId, filters],
    queryFn: () => catalogService.listProducts(storeId!, filters),
    enabled: !!storeId,
    placeholderData: keepPreviousData,
  })

  const items = productsQuery.data?.items ?? []
  const total = productsQuery.data?.total ?? 0
  const pageIds = useMemo(() => items.map((p) => p.id), [items])

  // Estoque da página atual — apenas com inventory.read.
  const stockQuery = useQuery({
    queryKey: ['catalog', 'products-stock', storeId, pageIds],
    queryFn: () => catalogService.getStockForProducts(pageIds),
    enabled: !!storeId && canReadStock && pageIds.length > 0,
  })
  const stockByProduct = useMemo(() => {
    const map = new Map<string, { quantity: number; reserved_quantity: number; available_quantity: number }>()
    for (const s of stockQuery.data ?? []) {
      map.set(s.product_id, {
        quantity: s.quantity ?? 0,
        reserved_quantity: s.reserved_quantity ?? 0,
        available_quantity: s.available_quantity ?? 0,
      })
    }
    return map
  }, [stockQuery.data])

  const archiveMutation = useMutation({
    mutationFn: (productId: string) => catalogService.archiveProduct(productId),
    onSuccess: () => {
      toastSuccess('Produto arquivado')
      setArchiving(null)
      queryClient.invalidateQueries({ queryKey: ['catalog', 'products', storeId] })
    },
    onError: (e) => {
      toastError(e, 'Não foi possível arquivar')
      setArchiving(null)
    },
  })

  const hasFilters = !!(debouncedSearch || categoryId || status || featured)
  const clearFilters = () => {
    setSearch('')
    setDebouncedSearch('')
    setCategoryId('')
    setStatus('')
    setFeatured(false)
    setPage(1)
  }

  const archivingProduct = archiving ? items.find((p) => p.id === archiving) : null
  const archivingHasStock = archiving ? (stockByProduct.get(archiving)?.quantity ?? 0) > 0 : false

  const colCount = canReadStock ? 9 : 8

  return (
    <div>
      <PageHeader
        title="Produtos"
        description="Cadastro, preços e destaque dos produtos da loja."
        actions={
          canManage ? (
            <Button asChild>
              <Link to="/app/catalog/products/new">
                <Plus /> Novo produto
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou SKU…"
            className="pl-8"
          />
        </div>
        <Select value={categoryId || 'all'} onValueChange={(v) => setCategoryId(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {(categoriesQuery.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.parent_id ? '— ' : ''}
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || 'all'}
          onValueChange={(v) => setStatus(v === 'all' ? '' : (v as ProductStatus))}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="ACTIVE">Ativo</SelectItem>
            <SelectItem value="INACTIVE">Inativo</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={featured ? 'default' : 'outline'}
          onClick={() => setFeatured((v) => !v)}
          aria-pressed={featured}
        >
          <Star className={featured ? 'fill-current' : ''} /> Em destaque
        </Button>
      </div>

      {productsQuery.isPending ? (
        <TableSkeleton rows={8} cols={colCount} />
      ) : productsQuery.isError ? (
        <ErrorRetryState onRetry={() => productsQuery.refetch()} retrying={productsQuery.isRefetching} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyFilteredState onClear={clearFilters} />
        ) : (
          <EmptyState
            title="Nenhum produto cadastrado"
            description="Crie o primeiro produto para começar a vender."
            action={
              canManage ? (
                <Button asChild>
                  <Link to="/app/catalog/products/new">
                    <Plus /> Criar produto
                  </Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Capa</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Destaque</TableHead>
                  {canReadStock && <TableHead className="text-right">Estoque</TableHead>}
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const cover = [...p.images].sort((a, b) => a.sort_order - b.sort_order)[0]
                  const coverUrl = productImageUrl(cover?.path)
                  const stock = stockByProduct.get(p.id)
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt={p.name}
                            className="h-10 w-10 rounded-md border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                            <ImageOff className="h-4 w-4" />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-64">
                        <span className="block truncate font-medium">{p.name}</span>
                      </TableCell>
                      <TableCell>
                        <CodeChip code={p.code} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.category?.name ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{brl(p.price)}</TableCell>
                      <TableCell>
                        <ProductStatusBadge status={p.status} />
                      </TableCell>
                      <TableCell>
                        {p.is_featured ? (
                          <Badge className="border-transparent bg-warning/15 text-warning">
                            <Star className="h-3 w-3 fill-current" /> Destaque
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {canReadStock && (
                        <TableCell className="text-right tabular-nums">
                          {stock ? (
                            <span>
                              <span className="font-medium">{stock.available_quantity}</span>
                              <span className="text-xs text-muted-foreground">
                                {' '}
                                disp. / {stock.reserved_quantity} res.
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">…</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        {canManage && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="Editar"
                              onClick={() => navigate(`/app/catalog/products/${p.id}`)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <ArchiveButton
                              disabled={(stock?.quantity ?? 0) > 0}
                              pending={archiveMutation.isPending}
                              onClick={() => setArchiving(p.id)}
                            />
                          </div>
                        )}
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

      <AlertDialog open={!!archiving} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar produto</AlertDialogTitle>
            <AlertDialogDescription>
              {archivingHasStock
                ? 'Este produto ainda tem estoque. Zere o estoque antes de arquivar.'
                : `"${archivingProduct?.name ?? ''}" sairá da vitrine e das listagens. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archivingHasStock || archiveMutation.isPending}
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

function ArchiveButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean
  pending: boolean
  onClick: () => void
}) {
  const button = (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-destructive"
      aria-label="Arquivar"
      disabled={disabled || pending}
      onClick={onClick}
    >
      <Archive className="h-4 w-4" />
    </Button>
  )
  if (!disabled) return button
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>Zere o estoque antes de arquivar.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
