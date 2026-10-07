import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { catalogService } from '@/services/catalog.service'
import { inventoryService } from '@/services/inventory.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { BackendError, rpc } from '@/lib/rpc'
import { messageFor } from '@/lib/errors'
import { toastError, toastSuccess } from '@/lib/feedback'
import { SLUG_RE, slugify } from '@/lib/format'
import { productImageUrl } from '@/lib/media'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyState,
  ErrorRetryState,
  NotFoundState,
  TableSkeleton,
} from '@/components/shared/page-state'
import { CharCount, FormField } from '@/components/shared/form'
import { MoneyInput } from '@/components/shared/money-input'
import { CodeChip } from '@/components/shared/order-status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type {
  AttachProductImageArgs,
  AttachProductImageResult,
  ProductAttributeInput,
  ProductInput,
  ProductPatch,
  ProductStatus,
  Uuid,
} from '@/types'

type ProductForEdit = NonNullable<Awaited<ReturnType<typeof catalogService.getProductForEdit>>>

interface AttributeRow {
  name: string
  value: string
}

interface ProductFormState {
  name: string
  slug: string
  slugTouched: boolean
  description: string
  categoryId: string | null
  status: ProductStatus
  price: number | null
  costPrice: number | null
  featured: boolean
  attributes: AttributeRow[]
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  slug: '',
  slugTouched: false,
  description: '',
  categoryId: null,
  status: 'INACTIVE',
  price: null,
  costPrice: null,
  featured: false,
  attributes: [],
}

interface FormErrors {
  name?: string
  slug?: string
  description?: string
  price?: string
  costPrice?: string
  attributes?: string
}

function normalizeAttributes(rows: AttributeRow[]): ProductAttributeInput[] {
  return rows
    .map((a) => ({ name: a.name.trim(), value: a.value.trim() }))
    .filter((a) => a.name && a.value)
}

function attributesEqual(a: ProductAttributeInput[], b: ProductAttributeInput[]) {
  if (a.length !== b.length) return false
  return a.every((x, i) => x.name === b[i].name && x.value === b[i].value)
}

function validateProductForm(form: ProductFormState): FormErrors {
  const errors: FormErrors = {}
  const name = form.name.trim()
  if (name.length < 2 || name.length > 160) errors.name = 'Informe um nome entre 2 e 160 caracteres.'
  const slug = form.slug.trim()
  if (slug && (slug.length < 2 || slug.length > 160 || !SLUG_RE.test(slug)))
    errors.slug = 'Use letras minúsculas, números e hífens (2 a 160 caracteres).'
  if (form.description.length > 10_000)
    errors.description = 'A descrição pode ter no máximo 10.000 caracteres.'
  if (form.price == null || form.price < 0) errors.price = 'Informe o preço (maior ou igual a zero).'
  if (form.costPrice != null && form.costPrice < 0) errors.costPrice = 'O custo não pode ser negativo.'
  const attrs = form.attributes
  if (attrs.length > 30) errors.attributes = messageFor('ATTRIBUTES_LIMIT_30')
  const seen = new Set<string>()
  for (const a of attrs) {
    const n = a.name.trim()
    const v = a.value.trim()
    if (!n && !v) continue
    if (n.length < 1 || n.length > 80 || v.length < 1 || v.length > 500) {
      errors.attributes = messageFor('INVALID_ATTRIBUTE_NAME_OR_VALUE')
      break
    }
    const key = n.toLowerCase()
    if (seen.has(key)) {
      errors.attributes = messageFor('DUPLICATE_ATTRIBUTE_NAME')
      break
    }
    seen.add(key)
  }
  return errors
}

export default function ProductFormPage() {
  const { productId } = useParams<{ productId: string }>()
  const isEdit = !!productId
  const storeId = useStoreId()
  const canManage = useHasStorePerm('catalog.products.manage')
  const canMedia = useHasStorePerm('catalog.products.media')
  const canEntry = useHasStorePerm('inventory.entry')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const justCreated = params.get('created') === '1'

  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM)
  const [original, setOriginal] = useState<ProductFormState | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [entryOpen, setEntryOpen] = useState(false)

  const productQuery = useQuery({
    queryKey: ['catalog', 'product', productId],
    queryFn: () => catalogService.getProductForEdit(productId!),
    enabled: isEdit,
  })

  const categoriesQuery = useQuery({
    queryKey: ['catalog', 'categories', storeId],
    queryFn: () => catalogService.listCategories(storeId!),
    enabled: !!storeId,
  })

  // Estoque do produto (para bloquear arquivar com saldo) — somente com inventory.read.
  const stockQuery = useQuery({
    queryKey: ['catalog', 'product-stock', productId],
    queryFn: async () => {
      const rows = await catalogService.getStockForProducts([productId!])
      return rows[0] ?? null
    },
    enabled: isEdit && !!storeId && canEntry,
  })
  const stockQuantity = stockQuery.data?.quantity ?? 0

  // Preenche o formulário quando o produto carrega.
  useEffect(() => {
    const p = productQuery.data
    if (!p) return
    const attrs = [...p.attributes].sort((a, b) => a.sort_order - b.sort_order)
    const loaded: ProductFormState = {
      name: p.name,
      slug: p.slug,
      slugTouched: true,
      description: p.description ?? '',
      categoryId: p.category_id,
      status: p.status,
      price: Number(p.price),
      costPrice: Number(p.cost_price),
      featured: p.is_featured,
      attributes: attrs.map((a) => ({ name: a.name, value: a.value })),
    }
    setForm(loaded)
    setOriginal(loaded)
  }, [productQuery.data])

  const setField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const queryClient = useQueryClient()

  const saveMutation = useMutation({
    mutationFn: async () => {
      const attrs = normalizeAttributes(form.attributes)
      if (!isEdit) {
        if (!storeId) throw new Error('NO_STORE')
        const input: ProductInput = {
          name: form.name.trim(),
          slug: form.slug.trim() || null,
          description: form.description || '',
          category_id: form.categoryId,
          status: form.status,
          price: form.price!,
          cost_price: form.costPrice ?? 0,
          is_featured: form.featured,
          attributes: attrs,
        }
        const r = await catalogService.createProduct(storeId, input)
        return { created: true as const, productId: r.product_id }
      }
      // Edição: diff original × form — envia SÓ campos alterados.
      const patch: ProductPatch = {}
      if (original) {
        if (form.name.trim() !== original.name) patch.name = form.name.trim()
        const slug = form.slug.trim()
        if (slug !== original.slug) patch.slug = slug || null
        if (form.description !== original.description) patch.description = form.description
        if ((form.categoryId ?? null) !== (original.categoryId ?? null))
          patch.category_id = form.categoryId
        if (form.status !== original.status) patch.status = form.status
        if (form.price !== original.price) patch.price = form.price!
        if ((form.costPrice ?? 0) !== original.costPrice) patch.cost_price = form.costPrice ?? 0
        if (form.featured !== original.featured) patch.is_featured = form.featured
      }
      const originalAttrs = original ? normalizeAttributes(original.attributes) : []
      const attrsChanged = !attributesEqual(attrs, originalAttrs)
      if (Object.keys(patch).length > 0) await catalogService.updateProduct(productId!, patch)
      if (attrsChanged) await catalogService.replaceAttributes(productId!, attrs)
      return { created: false as const, productId: productId! }
    },
    onSuccess: (r) => {
      if (r.created) {
        toastSuccess('Produto criado', 'Agora você pode adicionar imagens e registrar o estoque inicial.')
        queryClient.invalidateQueries({ queryKey: ['catalog', 'products', storeId] })
        navigate(`/app/catalog/products/${r.productId}?created=1`, { replace: true })
      } else {
        toastSuccess('Produto atualizado')
        setOriginal(form)
        queryClient.invalidateQueries({ queryKey: ['catalog', 'product', productId] })
        queryClient.invalidateQueries({ queryKey: ['catalog', 'products', storeId] })
        if (justCreated) setParams({}, { replace: true })
      }
    },
    onError: (e) => {
      if (e instanceof BackendError) {
        if (e.code === 'PRODUCT_SLUG_EXISTS' || e.code === '23505:products_store_slug') {
          setErrors((prev) => ({ ...prev, slug: messageFor('PRODUCT_SLUG_EXISTS') }))
          return
        }
        if (e.code === 'INVALID_MONEY_VALUE') {
          setErrors((prev) => ({ ...prev, price: messageFor('INVALID_MONEY_VALUE') }))
          return
        }
        if (e.code === 'DUPLICATE_ATTRIBUTE_NAME' || e.code === 'ATTRIBUTES_LIMIT_30' || e.code === 'INVALID_ATTRIBUTE_NAME_OR_VALUE') {
          setErrors((prev) => ({ ...prev, attributes: messageFor(e.code) }))
          return
        }
      }
      toastError(e, 'Não foi possível salvar')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => catalogService.archiveProduct(productId!),
    onSuccess: () => {
      toastSuccess('Produto arquivado')
      queryClient.invalidateQueries({ queryKey: ['catalog', 'products', storeId] })
      navigate('/app/catalog/products', { replace: true })
    },
    onError: (e) => toastError(e, 'Não foi possível arquivar'),
  })

  function submit() {
    const next = validateProductForm(form)
    setErrors(next)
    if (Object.keys(next).length > 0) return
    saveMutation.mutate()
  }

  // ---------- Render ----------

  if (isEdit && productQuery.isPending) {
    return (
      <div>
        <PageHeader title="Produto" />
        <TableSkeleton rows={8} cols={2} />
      </div>
    )
  }
  if (isEdit && productQuery.isError) {
    return (
      <div>
        <PageHeader title="Produto" />
        <ErrorRetryState onRetry={() => productQuery.refetch()} retrying={productQuery.isRefetching} />
      </div>
    )
  }
  if (isEdit && !productQuery.data) {
    return (
      <div>
        <PageHeader title="Produto" />
        <NotFoundState title="Produto não encontrado" backTo="/app/catalog/products" backLabel="Voltar aos produtos" />
      </div>
    )
  }

  const product = productQuery.data
  const dirty = isEdit && original ? JSON.stringify(form) !== JSON.stringify(original) : true

  return (
    <div>
      <PageHeader
        title={isEdit ? `Editar produto` : 'Novo produto'}
        description={isEdit ? 'Somente os campos alterados serão enviados ao salvar.' : 'Cadastre os dados básicos; imagens e estoque vêm depois.'}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/catalog/products">
              <ArrowLeft /> Voltar
            </Link>
          </Button>
        }
      />

      {justCreated && isEdit && (
        <Card className="mb-4 border-success/40 bg-success/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              Produto criado com sucesso. Adicione imagens abaixo e registre o estoque inicial.
            </p>
            {canEntry && (
              <Button size="sm" variant="outline" onClick={() => setEntryOpen(true)}>
                <PackagePlus /> Registrar entrada de estoque
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------- Dados ---------- */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dados do produto</CardTitle>
            {isEdit && product && (
              <CardDescription className="flex items-center gap-2">
                SKU <CodeChip code={product.code} /> (gerado automaticamente, não editável)
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField label="Nome" htmlFor="p-name" required error={errors.name}>
              <Input
                id="p-name"
                value={form.name}
                maxLength={160}
                disabled={!canManage}
                onChange={(e) => {
                  const name = e.target.value
                  setForm((f) => ({
                    ...f,
                    name,
                    // Sugere slug a partir do nome enquanto o usuário não editou o campo.
                    slug: f.slugTouched ? f.slug : slugify(name),
                  }))
                }}
              />
            </FormField>

            <FormField
              label="Slug (opcional)"
              htmlFor="p-slug"
              hint="Endereço do produto na vitrine. Vazio = gerado do nome."
              error={errors.slug}
            >
              <Input
                id="p-slug"
                value={form.slug}
                maxLength={160}
                disabled={!canManage}
                className="font-mono"
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value, slugTouched: true }))}
              />
            </FormField>

            <FormField
              label="Descrição"
              htmlFor="p-desc"
              error={errors.description}
              hint={!errors.description ? 'Texto simples exibido na página do produto.' : undefined}
            >
              <div className="space-y-1">
                <Textarea
                  id="p-desc"
                  value={form.description}
                  rows={5}
                  disabled={!canManage}
                  onChange={(e) => setField('description', e.target.value)}
                />
                <div className="flex justify-end">
                  <CharCount value={form.description} max={10_000} />
                </div>
              </div>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Categoria">
                <Select
                  value={form.categoryId ?? 'none'}
                  onValueChange={(v) => setField('categoryId', v === 'none' ? null : v)}
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sem categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {(categoriesQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.parent_id ? '— ' : ''}
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Status">
                <Select
                  value={form.status}
                  onValueChange={(v) => setField('status', v as ProductStatus)}
                  disabled={!canManage}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INACTIVE">Inativo (rascunho)</SelectItem>
                    <SelectItem value="ACTIVE">Ativo (visível se a loja estiver publicada)</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField label="Preço" required error={errors.price}>
                <MoneyInput
                  value={form.price}
                  onChange={(v) => setField('price', v)}
                  disabled={!canManage}
                />
              </FormField>

              <FormField
                label="Custo de referência"
                hint="Custo de referência (não altera o custo do estoque)."
                error={errors.costPrice}
              >
                <MoneyInput
                  value={form.costPrice}
                  onChange={(v) => setField('costPrice', v)}
                  disabled={!canManage}
                />
              </FormField>
            </div>

            <FormField label="Destaque na vitrine">
              <div className="flex h-9 items-center">
                <Switch
                  checked={form.featured}
                  onCheckedChange={(v) => setField('featured', v)}
                  disabled={!canManage}
                />
              </div>
            </FormField>

            {/* ---------- Atributos ---------- */}
            <FormField
              label={`Atributos (${form.attributes.length}/30)`}
              hint="Ex.: Cor = Azul, Tamanho = M. Nomes não podem se repetir."
              error={errors.attributes}
            >
              <div className="space-y-2">
                {form.attributes.map((attr, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={attr.name}
                      maxLength={80}
                      placeholder="Nome"
                      disabled={!canManage}
                      className="w-44"
                      onChange={(e) =>
                        setForm((f) => {
                          const attrs = [...f.attributes]
                          attrs[i] = { ...attrs[i], name: e.target.value }
                          return { ...f, attributes: attrs }
                        })
                      }
                    />
                    <Input
                      value={attr.value}
                      maxLength={500}
                      placeholder="Valor"
                      disabled={!canManage}
                      className="flex-1"
                      onChange={(e) =>
                        setForm((f) => {
                          const attrs = [...f.attributes]
                          attrs[i] = { ...attrs[i], value: e.target.value }
                          return { ...f, attributes: attrs }
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      disabled={!canManage}
                      aria-label="Remover atributo"
                      onClick={() =>
                        setForm((f) => ({ ...f, attributes: f.attributes.filter((_, j) => j !== i) }))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {canManage && form.attributes.length < 30 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setForm((f) => ({ ...f, attributes: [...f.attributes, { name: '', value: '' }] }))
                    }
                  >
                    <Plus /> Adicionar atributo
                  </Button>
                )}
              </div>
            </FormField>
          </CardContent>
        </Card>

        {/* ---------- Ações ---------- */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Salvar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {canManage ? (
                <Button
                  className="w-full"
                  onClick={submit}
                  disabled={saveMutation.isPending || (isEdit && !dirty)}
                >
                  {saveMutation.isPending && <RefreshCw className="animate-spin" />}
                  {isEdit ? 'Salvar alterações' : 'Criar produto'}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Você não tem permissão para editar produtos.
                </p>
              )}
              {isEdit && !dirty && (
                <p className="text-xs text-muted-foreground">Nenhuma alteração pendente.</p>
              )}
            </CardContent>
          </Card>

          {isEdit && canManage && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-destructive">Zona de risco</CardTitle>
                <CardDescription>Arquivar remove o produto da vitrine e das listagens.</CardDescription>
              </CardHeader>
              <CardContent>
                <ArchiveProductButton
                  disabled={canEntry && stockQuantity > 0}
                  pending={archiveMutation.isPending}
                  onClick={() => setArchiveOpen(true)}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ---------- Imagens (somente edição) ---------- */}
      {isEdit && product && (
        <ProductImagesCard
          product={product}
          storeId={storeId!}
          canMedia={canMedia}
        />
      )}

      {/* ---------- Estoque inicial (recém-criado) ---------- */}
      {isEdit && justCreated && canEntry && product && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Estoque inicial</CardTitle>
            <CardDescription>
              O estoque não faz parte do cadastro: registre uma entrada com o custo unitário de compra.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setEntryOpen(true)}>
              <PackagePlus /> Registrar entrada de estoque
            </Button>
          </CardContent>
        </Card>
      )}

      {isEdit && product && (
        <InitialEntryDialog
          open={entryOpen}
          productId={product.id}
          productName={product.name}
          onClose={() => setEntryOpen(false)}
          onDone={() => {
            setEntryOpen(false)
            setParams({}, { replace: true })
          }}
        />
      )}

      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar produto</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${product?.name ?? ''}" sairá da vitrine e das listagens. Esta ação não pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                archiveMutation.mutate()
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

// ---------- Botão arquivar com tooltip de estoque ----------

function ArchiveProductButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean
  pending: boolean
  onClick: () => void
}) {
  const button = (
    <Button variant="destructive" className="w-full" disabled={disabled || pending} onClick={onClick}>
      <Archive /> Arquivar produto
    </Button>
  )
  if (!disabled) return button
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="block">{button}</span>
        </TooltipTrigger>
        <TooltipContent>Zere o estoque antes de arquivar (contagem = 0).</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

// ---------- Card de imagens (até 4) ----------

function ProductImagesCard({
  product,
  storeId,
  canMedia,
}: {
  product: ProductForEdit
  storeId: Uuid
  canMedia: boolean
}) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [altEditing, setAltEditing] = useState<{ imageId: string; path: string; value: string } | null>(null)

  const images = useMemo(
    () => [...product.images].sort((a, b) => a.sort_order - b.sort_order),
    [product.images],
  )

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['catalog', 'product', product.id] })
    queryClient.invalidateQueries({ queryKey: ['catalog', 'products', storeId] })
  }

  const uploadMutation = useMutation({
    mutationFn: (file: File) => catalogService.addProductImage(storeId, product.id, file),
    onSuccess: () => {
      toastSuccess('Imagem adicionada')
      invalidate()
    },
    onError: (e) => toastError(e, 'Não foi possível enviar a imagem'),
  })

  const removeMutation = useMutation({
    mutationFn: (imageId: Uuid) => catalogService.removeProductImage(product.id, imageId),
    onSuccess: () => {
      toastSuccess('Imagem removida')
      invalidate()
    },
    onError: (e) => toastError(e, 'Não foi possível remover'),
  })

  const reorderMutation = useMutation({
    mutationFn: (ids: Uuid[]) => catalogService.reorderProductImages(product.id, ids),
    onSuccess: invalidate,
    onError: (e) => {
      toastError(e, 'Não foi possível reordenar')
      invalidate()
    },
  })

  // Alt text: sem RPC de edição → detach (mantendo o arquivo) + re-attach com novo alt,
  // depois restaura a posição original da imagem.
  const altMutation = useMutation({
    mutationFn: async ({ imageId, path, value }: { imageId: Uuid; path: string; value: string }) => {
      const oldIndex = images.findIndex((i) => i.id === imageId)
      await catalogService.removeProductImage(product.id, imageId, { keepFile: true })
      const r = await rpc<AttachProductImageArgs, AttachProductImageResult>('attach_product_image', {
        p_product_id: product.id,
        p_path: path,
        p_alt_text: value.trim().slice(0, 200),
      })
      const without = images.filter((i) => i.id !== imageId).map((i) => i.id)
      const next = [...without]
      next.splice(Math.min(oldIndex, next.length), 0, r.image_id)
      await catalogService.reorderProductImages(product.id, next)
    },
    onSuccess: () => {
      toastSuccess('Texto alternativo atualizado')
      setAltEditing(null)
      invalidate()
    },
    onError: (e) => {
      toastError(e, 'Não foi possível atualizar o texto alternativo')
      invalidate()
    },
  })

  const busy =
    uploadMutation.isPending || removeMutation.isPending || reorderMutation.isPending || altMutation.isPending

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toastError(new BackendError('IMAGE_TOO_LARGE', ''), 'Imagem muito grande')
      return
    }
    uploadMutation.mutate(file)
  }

  function move(index: number, delta: -1 | 1) {
    const ids = images.map((i) => i.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    reorderMutation.mutate(ids)
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="text-base">Imagens ({images.length}/4)</CardTitle>
        <CardDescription>
          PNG, JPG ou WebP de até 5 MB. A primeira imagem é a capa da vitrine.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!canMedia ? (
          <p className="text-sm text-muted-foreground">
            Você não tem permissão para gerenciar as imagens do produto.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {images.map((img, i) => {
              const url = productImageUrl(img.path)
              return (
                <div key={img.id} className="group relative overflow-hidden rounded-lg border bg-muted">
                  {url ? (
                    <img src={url} alt={img.alt_text || product.name} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="aspect-square w-full" />
                  )}
                  {i === 0 && (
                    <Badge className="absolute left-2 top-2 border-transparent bg-primary text-primary-foreground">
                      Capa
                    </Badge>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 p-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-white hover:text-white"
                      disabled={busy || i === 0}
                      aria-label="Mover para a esquerda"
                      onClick={() => move(i, -1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-white hover:text-white"
                      disabled={busy}
                      aria-label="Editar texto alternativo"
                      onClick={() => setAltEditing({ imageId: img.id, path: img.path, value: img.alt_text })}
                    >
                      <ImagePlus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-white hover:text-white"
                      disabled={busy || i === images.length - 1}
                      aria-label="Mover para a direita"
                      onClick={() => move(i, 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={busy}
                      aria-label="Remover imagem"
                      onClick={() => removeMutation.mutate(img.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
            {images.length < 4 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  'flex aspect-square flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                  busy && 'cursor-not-allowed opacity-50',
                )}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="h-5 w-5" />
                )}
                Enviar imagem
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        )}
      </CardContent>

      <Dialog open={!!altEditing} onOpenChange={(open) => !open && setAltEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Texto alternativo</DialogTitle>
            <DialogDescription>
              Descreve a imagem para acessibilidade e SEO. A imagem será reposicionada no mesmo lugar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={altEditing?.value ?? ''}
            maxLength={200}
            placeholder="Ex.: Camiseta preta em fundo branco"
            onChange={(e) => altEditing && setAltEditing({ ...altEditing, value: e.target.value })}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAltEditing(null)} disabled={altMutation.isPending}>
              Cancelar
            </Button>
            <Button
              disabled={altMutation.isPending || !altEditing}
              onClick={() => altEditing && altMutation.mutate(altEditing)}
            >
              {altMutation.isPending && <RefreshCw className="animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ---------- Dialog de entrada de estoque inicial ----------

function InitialEntryDialog({
  open,
  productId,
  productName,
  onClose,
  onDone,
}: {
  open: boolean
  productId: Uuid
  productName: string
  onClose: () => void
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [qty, setQty] = useState('')
  const [unitCost, setUnitCost] = useState<number | null>(null)
  const [reason, setReason] = useState('Estoque inicial do produto')
  const [reference, setReference] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      inventoryService.registerMovement({
        productId,
        type: 'ENTRY',
        quantity: Number(qty),
        unitCost,
        reason,
        reference: reference || null,
      }),
    onSuccess: () => {
      toastSuccess('Entrada registrada', `Estoque de "${productName}" atualizado.`)
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['catalog', 'product-stock', productId] })
      onDone()
    },
    onError: (e) => {
      if (e instanceof BackendError && e.code === 'INVALID_UNIT_COST') {
        setFieldError(messageFor('INVALID_UNIT_COST'))
        return
      }
      toastError(e, 'Não foi possível registrar a entrada')
    },
  })

  function submit() {
    setFieldError(null)
    const q = Number(qty)
    if (!Number.isInteger(q) || q < 1) {
      setFieldError('A quantidade deve ser um número inteiro maior que zero.')
      return
    }
    if (unitCost == null || unitCost < 0) {
      setFieldError('Informe o custo unitário da entrada.')
      return
    }
    if (reason.trim().length < 3 || reason.trim().length > 500) {
      setFieldError('O motivo deve ter entre 3 e 500 caracteres.')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Entrada de estoque</DialogTitle>
          <DialogDescription>
            Entrada inicial de "{productName}". O custo unitário é obrigatório e atualiza o custo médio.
          </DialogDescription>
        </DialogHeader>
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
          <FormField label="Custo unitário" required hint="Obrigatório na entrada (até 6 casas decimais).">
            <MoneyInput value={unitCost} onChange={setUnitCost} />
          </FormField>
          <FormField label="Motivo" required>
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </FormField>
          <FormField label="Referência (opcional)" hint="Ex.: número da nota fiscal.">
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
            Registrar entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
