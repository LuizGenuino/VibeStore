import { STOREFRONT_API_URL } from '@/lib/constants'
import type {
  CatalogData,
  CatalogFilters,
  CheckoutRequest,
  CheckoutData,
  OrderStatusData,
  ProductData,
  StorefrontErrorCode,
} from '@/types/storefront'

/**
 * Cliente HTTP da Edge storefront-api (guia 19) — SEM sessão do lojista.
 * A vitrine pública fala exclusivamente com a Edge via POST; nunca chama
 * as RPCs service-only nem lê tabelas (anon não tem SELECT no negócio).
 */
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export class StorefrontError extends Error {
  constructor(
    public status: number,
    public code: StorefrontErrorCode | 'NETWORK_ERROR',
    public retryAfter?: number,
  ) {
    super(code)
    this.name = 'StorefrontError'
  }
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status === 503
  }
  get notFound() {
    return this.status === 404
  }
}

async function call<T>(body: object, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(STOREFRONT_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON }, // sem Authorization do usuário
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new StorefrontError(0, 'NETWORK_ERROR')
  }
  const json = (await res.json().catch(() => ({ error: 'SERVICE_UNAVAILABLE' }))) as
    | { data: T }
    | { error: StorefrontErrorCode }
  if (!res.ok || 'error' in json) {
    throw new StorefrontError(
      res.status,
      'error' in json ? json.error : 'SERVICE_UNAVAILABLE',
      Number(res.headers.get('retry-after')) || undefined,
    )
  }
  return (json as { data: T }).data
}

export const storefrontApi = {
  catalog: (store_slug: string, filters: CatalogFilters = {}, signal?: AbortSignal) =>
    call<CatalogData>({ action: 'catalog', store_slug, filters }, signal),
  product: (store_slug: string, product_slug: string) =>
    call<ProductData>({ action: 'product', store_slug, product_slug }),
  checkout: (req: Omit<CheckoutRequest, 'action'>) =>
    call<CheckoutData>({ action: 'checkout', ...req }),
  orderStatus: (store_slug: string, order_id: string, token: string) =>
    call<OrderStatusData>({ action: 'order-status', store_slug, order_id, token }),
}
