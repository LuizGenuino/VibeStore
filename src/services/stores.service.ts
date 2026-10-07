import { BackendError, rpc, toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { clearPending, stablePending } from '@/lib/pending'
import { assertImage, storeMediaPath, type Bucket } from '@/lib/media'
import type {
  ArchiveStoreArgs,
  ArchiveStoreResult,
  CheckStoreSlugResult,
  CreateStoreInput,
  CreateStoreResult,
  SetStorePublicationArgs,
  SetStorePublicationResult,
  StoresRow,
  StoreUpdatePatch,
  Uuid,
} from '@/types'

export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'auth', 'login', 'signup', 'dashboard', 'settings', 'sudo', 'supabase',
]

/** Loja: onboarding, configurações, publicação, arquivamento e branding (guia 8–9). */
export const storesService = {
  checkSlug: (slug: string) =>
    rpc<{ p_slug: string }, CheckStoreSlugResult>('check_store_slug', { p_slug: slug }),

  /** Criação idempotente: mesmo request_id entre retries; created=false é replay bem-sucedido. */
  async createStore(planId: Uuid, input: CreateStoreInput): Promise<CreateStoreResult> {
    const clean: CreateStoreInput = {
      ...input,
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      title: input.title?.trim() || null,
      subtitle: input.subtitle?.trim() || null,
      social_links: Object.fromEntries(
        Object.entries(input.social_links ?? {}).filter(([, v]) => !!v),
      ),
    }
    const op = stablePending('onboarding:create-store', { planId, clean })
    try {
      const result = await rpc<object, CreateStoreResult>('create_store', {
        p_request_id: op.requestId,
        p_plan_id: planId,
        p_input: clean,
      })
      clearPending('onboarding:create-store')
      return result
    } catch (e) {
      // Erro de negócio definitivo: limpa para permitir nova intenção com payload corrigido.
      if (e instanceof BackendError && !e.isNetwork) clearPending('onboarding:create-store')
      throw e
    }
  },

  /** UPDATE direto nas 13 colunas com GRANT (único caso de escrita direta). */
  async updateStore(storeId: Uuid, patch: StoreUpdatePatch): Promise<StoresRow> {
    const { is_published: _isPublished, ...rest } = patch // publicação vai pela RPC
    const { data, error } = await supabase.from('stores').update(rest).eq('id', storeId).select('*')
    if (error) throw toBackendError(error)
    if (!data?.length) throw new BackendError('STORE_UNAVAILABLE', '42501')
    return data[0] as StoresRow
  },

  setPublication: (storeId: Uuid, published: boolean) =>
    rpc<SetStorePublicationArgs, SetStorePublicationResult>('set_store_publication', {
      p_store_id: storeId,
      p_published: published,
    }),

  archiveStore: (storeId: Uuid) =>
    rpc<ArchiveStoreArgs, ArchiveStoreResult>('archive_store', { p_store_id: storeId }),

  /**
   * Troca de logo/banner em ordem segura (guia 9.1):
   * upload imutável → UPDATE do path → remove o anterior. Falha no UPDATE apaga o órfão.
   */
  async replaceStoreMedia(
    storeId: Uuid,
    kind: 'logo' | 'banner',
    file: File,
    oldPath: string | null,
  ): Promise<string> {
    const bucket: Bucket = kind === 'logo' ? 'store-logos' : 'store-banners'
    assertImage(file, bucket)
    const path = storeMediaPath(storeId, file)
    const up = await supabase.storage
      .from(bucket)
      .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '31536000' })
    if (up.error) throw toBackendError(up.error as never)
    try {
      await storesService.updateStore(storeId, kind === 'logo' ? { logo_path: path } : { banner_path: path })
    } catch (e) {
      await supabase.storage.from(bucket).remove([path]) // limpa órfão
      throw e
    }
    if (oldPath) await supabase.storage.from(bucket).remove([oldPath]) // best-effort
    return path
  },

  async removeStoreMedia(storeId: Uuid, kind: 'logo' | 'banner', oldPath: string) {
    const bucket: Bucket = kind === 'logo' ? 'store-logos' : 'store-banners'
    await storesService.updateStore(storeId, kind === 'logo' ? { logo_path: null } : { banner_path: null })
    await supabase.storage.from(bucket).remove([oldPath]) // policy só permite remover não vinculados
  },
}
