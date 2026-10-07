import type {
  Uuid, IsoDateTime, OrderStatus, OrderEventType, ManualMethod,
  SocialLinks, ProductAttributeInput, CustomerSnapshot, DeliveryAddress,
} from './backend'

// ============================================================
// src/types/storefront.ts (PROPOSTA) — contrato HTTP da Edge storefront-api
// ============================================================
export type StorefrontAction = 'catalog' | 'product' | 'checkout' | 'order-status'

export interface CatalogFilters {
  search?: string                 // 0..100
  category_id?: Uuid | null       // inclui subcategorias quando é categoria-mãe
  min_price?: number | null       // 0..9999999999.99
  max_price?: number | null       // >= min_price
  in_stock?: boolean
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name_asc'   // default 'newest'
  page?: number                   // inteiro 1..1000, default 1
  page_size?: number              // inteiro 1..24, default 20
}
export interface CatalogRequest { action: 'catalog'; store_slug: string; filters?: CatalogFilters }
export interface ProductRequest { action: 'product'; store_slug: string; product_slug: string }
export interface CheckoutInput {
  customer: { full_name: string; phone: string }     // 2..120 / E.164
  address: DeliveryAddress
  items: Array<{ product_id: Uuid; quantity: number }> // 1..20 itens, inteiros 1..999, sem repetição
  note?: string                                        // 0..1000
}
export interface CheckoutRequest {
  action: 'checkout'; store_slug: string
  request_id: Uuid           // UUID v1..v5, gerado UMA vez por tentativa e reutilizado nos retries
  client_secret: string      // 32 bytes aleatórios em base64url sem '=' (43 chars), idem
  input: CheckoutInput
}
export interface OrderStatusRequest { action: 'order-status'; store_slug: string; order_id: Uuid; token: string }

export interface PublicImage { path: string; alt_text: string; sort_order: number }
export interface PublicProduct {
  id: Uuid; code: string; name: string; slug: string; description: string
  price: number; category_id: Uuid | null; is_featured: boolean
  in_stock: boolean               // disponível - reservado > 0 (quantidade NÃO é exposta)
  images: PublicImage[]           // ordenadas por sort_order; [0] = capa
  attributes: ProductAttributeInput[]
}
export interface PublicStore {
  name: string; title: string; subtitle: string; slug: string
  logo_path: string | null; banner_path: string | null
  primary_color: string; secondary_color: string
  social_links: SocialLinks; whatsapp_number: string
}
export interface PublicCategory { id: Uuid; name: string; slug: string; parent_id: Uuid | null }
export interface CatalogData {
  store: PublicStore; categories: PublicCategory[]; products: PublicProduct[]
  total: number; page: number; page_size: number
}
export type ProductData = PublicProduct
export interface CheckoutData {
  order_id: Uuid; code: string          // ex.: 'PED-000001'
  subtotal: number; status: 'PENDING' | OrderStatus
  reservation_expires_at: IsoDateTime   // +24h; NÃO renovado em replay
  replayed: boolean
  whatsapp_number: string
  token: string                         // 43 chars; segredo de acompanhamento
  tracking_url: string                  // `${APP_URL}/s/{slug}/pedido/{order_id}#token=...`
  whatsapp_url: string                  // https://wa.me/<digits>?text=...
  shipping_included: false
}
export interface OrderStatusData {
  order_id: Uuid; code: string; status: OrderStatus; revision: number; created_at: IsoDateTime
  subtotal: number; shipping_amount: number; shipping_confirmed: boolean
  total: number; shipping_included: boolean; payment_method: 'WHATSAPP'
  tracking_code: string | null
  paid_at: IsoDateTime | null; shipped_at: IsoDateTime | null; delivered_at: IsoDateTime | null
  cancelled_at: IsoDateTime | null; returned_at: IsoDateTime | null
  customer: CustomerSnapshot; address: DeliveryAddress; note: string
  reservation_expires_at: IsoDateTime; reservation_active: boolean
  payment: { received: boolean; refunded: boolean; method: ManualMethod | null }
  timeline: Array<{ event: OrderEventType; status: OrderStatus; created_at: IsoDateTime }>
  items: Array<{ name: string; code: string; quantity: number; unit_price: number; line_total: number;
                 image_path: string | null; attributes: ProductAttributeInput[] }>
}
export type StorefrontErrorCode =
  | 'NOT_FOUND' | 'INVALID_BODY' | 'UNKNOWN_FIELD' | 'INVALID_FIELD' | 'INVALID_SLUG' | 'INVALID_UUID'
  | 'INVALID_TOKEN' | 'INVALID_JSON' | 'INVALID_ACTION' | 'INVALID_STORE_SLUG' | 'INVALID_PRICE_FILTER'
  | 'INVALID_PRICE_RANGE' | 'INVALID_STOCK_FILTER' | 'INVALID_SORT' | 'INVALID_PAGINATION' | 'INVALID_PHONE'
  | 'INVALID_ADDRESS' | 'INVALID_ITEMS' | 'DUPLICATE_PRODUCT' | 'INVALID_QUANTITY' | 'INVALID_REQUEST'
  | 'ORIGIN_NOT_ALLOWED' | 'METHOD_NOT_ALLOWED' | 'BODY_TOO_LARGE' | 'JSON_REQUIRED' | 'RATE_LIMITED'
  | 'STORE_UNAVAILABLE' | 'PRODUCT_UNAVAILABLE' | 'INSUFFICIENT_AVAILABLE_STOCK' | 'IDEMPOTENCY_KEY_REUSED'
  | 'ORDER_TOTAL_LIMIT' | 'SERVICE_UNAVAILABLE'
export type StorefrontResponse<T> = { data: T } | { error: StorefrontErrorCode }
