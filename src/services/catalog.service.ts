import { rpc, toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { clearPending, stablePending } from '@/lib/pending'
import { assertImage, productMediaPath } from '@/lib/media'
import type {
  ArchiveCategoryArgs,
  ArchiveCategoryResult,
  ArchiveProductArgs,
  ArchiveProductResult,
  AttachProductImageArgs,
  AttachProductImageResult,
  CategoriesRow,
  CategoryInput,
  CategoryPatch,
  CreateCategoryArgs,
  CreateCategoryResult,
  CreateProductArgs,
  CreateProductResult,
  DetachProductImageArgs,
  DetachProductImageResult,
  ProductPatch,
  ProductsRow,
  ProductStatus,
  ReorderProductImagesArgs,
  ReorderProductImagesResult,
  ReplaceProductAttributesArgs,
  ReplaceProductAttributesResult,
  UpdateCategoryArgs,
  UpdateCategoryResult,
  UpdateProductArgs,
  UpdateProductResult,
  Uuid,
} from '@/types'

export interface ProductListItem extends ProductsRow {
  category: { id: Uuid; name: string; parent_id: Uuid | null } | null
  images: { path: string; sort_order: number }[]
}

export interface ProductListFilters {
  search?: string
  categoryId?: Uuid | null
  status?: ProductStatus | ''
  featured?: boolean
  sort?: string
  asc?: boolean
  page: number
  pageSize?: number
}

/** Catálogo: categorias, produtos, atributos e imagens (guia 10–11). Escrita SOMENTE por RPC. */
export const catalogService = {
  // ---------- Categorias ----------
  async listCategories(storeId: Uuid): Promise<CategoriesRow[]> {
    const { data, error } = await supabase
      .from('categories')
      .select('id, parent_id, code, name, slug, is_active, sort_order, created_at, updated_at')
      .eq('store_id', storeId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) throw toBackendError(error)
    return (data ?? []) as CategoriesRow[]
  },

  async createCategory(storeId: Uuid, input: CategoryInput): Promise<CreateCategoryResult> {
    const op = stablePending('category:new', input)
    const r = await rpc<CreateCategoryArgs, CreateCategoryResult>('create_category', {
      p_store_id: storeId,
      p_request_id: op.requestId,
      p_input: { ...input, name: input.name.trim(), slug: input.slug?.trim() || null },
    })
    clearPending('category:new')
    return r
  },

  updateCategory: (categoryId: Uuid, patch: CategoryPatch) =>
    rpc<UpdateCategoryArgs, UpdateCategoryResult>('update_category', {
      p_category_id: categoryId,
      p_patch: patch,
    }),

  archiveCategory: (categoryId: Uuid) =>
    rpc<ArchiveCategoryArgs, ArchiveCategoryResult>('archive_category', {
      p_category_id: categoryId,
    }),

  /** Produtos vivos na categoria (para decidir se pode arquivar). */
  async countProductsInCategory(categoryId: Uuid): Promise<number> {
    const { count, error } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId)
    if (error) throw toBackendError(error)
    return count ?? 0
  },

  // ---------- Produtos ----------
  async listProducts(storeId: Uuid, f: ProductListFilters) {
    const pageSize = f.pageSize ?? 20
    let q = supabase
      .from('products')
      .select(
        `id, store_id, code, name, slug, description, status, price, cost_price, is_featured,
         category_id, created_at, updated_at, archived_at, request_id, request_payload,
         category:categories(id, name, parent_id),
         images:product_images(path, sort_order)`,
        { count: 'exact' },
      )
      .eq('store_id', storeId)
    if (f.search) {
      const term = f.search.replace(/[%_,()]/g, ' ').trim() // não injetar sintaxe PostgREST no .or()
      if (term) q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%`)
    }
    if (f.categoryId) q = q.eq('category_id', f.categoryId)
    if (f.status) q = q.eq('status', f.status)
    if (f.featured) q = q.eq('is_featured', true)
    const { data, count, error } = await q
      .order(f.sort ?? 'updated_at', { ascending: f.asc ?? false })
      .order('id')
      .range((f.page - 1) * pageSize, f.page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as unknown as ProductListItem[], total: count ?? 0, pageSize }
  },

  /** Estoque da página atual de produtos (somente se inventory.read). */
  async getStockForProducts(productIds: Uuid[]) {
    if (productIds.length === 0) return []
    const { data, error } = await supabase
      .from('product_stock_balances')
      .select('product_id, quantity, reserved_quantity, available_quantity, average_cost, revision')
      .in('product_id', productIds)
    if (error) throw toBackendError(error)
    return data ?? []
  },

  async getProductForEdit(productId: Uuid) {
    const { data, error } = await supabase
      .from('products')
      .select(
        `*, attributes:product_attributes(name, value, sort_order),
         images:product_images(id, path, alt_text, sort_order)`,
      )
      .eq('id', productId)
      .maybeSingle()
    if (error) throw toBackendError(error)
    return data as
      | (ProductsRow & {
          attributes: { name: string; value: string; sort_order: number }[]
          images: { id: Uuid; path: string; alt_text: string; sort_order: number }[]
        })
      | null
  },

  async createProduct(storeId: Uuid, input: CreateProductArgs['p_input']): Promise<CreateProductResult> {
    const op = stablePending('product:new', input)
    const r = await rpc<CreateProductArgs, CreateProductResult>('create_product', {
      p_store_id: storeId,
      p_request_id: op.requestId,
      p_input: {
        ...input,
        name: input.name.trim(),
        slug: input.slug?.trim() || null,
        attributes: (input.attributes ?? []).filter((a) => a.name.trim() && a.value.trim()),
      },
    })
    clearPending('product:new')
    return r
  },

  updateProduct: (productId: Uuid, patch: ProductPatch) =>
    rpc<UpdateProductArgs, UpdateProductResult>('update_product', {
      p_product_id: productId,
      p_patch: patch,
    }),

  replaceAttributes: (productId: Uuid, attributes: { name: string; value: string }[]) =>
    rpc<ReplaceProductAttributesArgs, ReplaceProductAttributesResult>('replace_product_attributes', {
      p_product_id: productId,
      p_attributes: attributes,
    }),

  archiveProduct: (productId: Uuid) =>
    rpc<ArchiveProductArgs, ArchiveProductResult>('archive_product', { p_product_id: productId }),

  // ---------- Imagens (até 4) ----------
  async addProductImage(storeId: Uuid, productId: Uuid, file: File, alt = '') {
    assertImage(file, 'product-images')
    const path = productMediaPath(storeId, productId, file)
    const up = await supabase.storage
      .from('product-images')
      .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' })
    if (up.error) throw toBackendError(up.error as never)
    try {
      return await rpc<AttachProductImageArgs, AttachProductImageResult>('attach_product_image', {
        p_product_id: productId,
        p_path: path,
        p_alt_text: alt.slice(0, 200),
      })
    } catch (e) {
      await supabase.storage.from('product-images').remove([path]) // falhou ao vincular → remove órfão
      throw e
    }
  },

  async removeProductImage(productId: Uuid, imageId: Uuid, opts?: { keepFile?: boolean }) {
    const r = await rpc<DetachProductImageArgs, DetachProductImageResult>('detach_product_image', {
      p_product_id: productId,
      p_image_id: imageId,
    })
    if (r.detached && r.path && !opts?.keepFile) {
      await supabase.storage.from('product-images').remove([r.path])
    }
    return r
  },

  reorderProductImages: (productId: Uuid, imageIds: Uuid[]) =>
    rpc<ReorderProductImagesArgs, ReorderProductImagesResult>('reorder_product_images', {
      p_product_id: productId,
      p_image_ids: imageIds,
    }),
}
