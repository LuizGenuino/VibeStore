import type {
  Json, Uuid, IsoDateTime, IsoDate, ProductStatus, InventoryMovementType, OrderStatus,
  OrderEventType, ManualMethod, ReturnDisposition, ExpenseClassification, ExpenseKind,
  PlatformRole, StoreContextRole, PermissionCode, SocialLinks, ProductAttributeInput,
  CustomerSnapshot, DeliveryAddress, StoreSnapshot, StoresRow, ProfilesRow,
} from './backend'

// ============================================================
// src/types/rpc.ts (PROPOSTA) — entradas e saídas das 35 RPCs client
// ============================================================

// ---------- Identidade / acesso ----------
export interface MyAccess {
  user_id: Uuid | null
  account_active: boolean
  can_manage_security: boolean
  roles: string[]                 // códigos globais ativos: 'USER', 'SUDO' (OWNER NUNCA aparece aqui)
  permissions: PermissionCode[]   // permissões GLOBAIS (via user_platform_roles)
}
export type StoreAccess = null | {
  store_id: Uuid
  role: StoreContextRole          // 'OWNER' se owner_id = auth.uid(); senão 'SUDO' (store.admin)
  permissions: PermissionCode[]   // permissões efetivas NA loja
}
export interface SudoSetUserActiveArgs { p_user_id: Uuid; p_active: boolean }   // retorno: void (data = null)

// ---------- Loja ----------
export interface CheckStoreSlugArgs { p_slug: string }
export interface CheckStoreSlugResult { valid: boolean; available: boolean }

export interface CreateStoreInput {
  name: string                 // 2..120 (trim)
  slug: string                 // 3..63, ^[a-z0-9]+(-[a-z0-9]+)*$, sem palavras reservadas
  whatsapp_number: string      // E.164: ^\+[1-9][0-9]{7,14}$
  title?: string | null        // 2..160; default = name
  subtitle?: string | null     // <= 300; default ''
  cnpj?: string | null         // 1..32, texto livre (sem validação fiscal)
  email?: string | null        // normalizado para minúsculas
  primary_color?: string | null   // #RRGGBB; default #6750A4 (gravado em MAIÚSCULAS)
  secondary_color?: string | null // #RRGGBB; default #03A9F4
  social_links?: SocialLinks   // ÚNICA chave que pode ser objeto
}
export interface CreateStoreArgs { p_request_id: Uuid; p_plan_id: Uuid; p_input: CreateStoreInput }
export interface CreateStoreResult { store_id: Uuid; slug: string; plan_id: Uuid; created: boolean }  // created=false => replay

export interface SetStorePublicationArgs { p_store_id: Uuid; p_published: boolean }
export interface SetStorePublicationResult { store_id: Uuid; is_published: boolean }
export interface ArchiveStoreArgs { p_store_id: Uuid }
export interface ArchiveStoreResult { store_id: Uuid; archived: true; already_archived: boolean }

/** UPDATE direto em public.stores (único caso de escrita direta). Somente estas colunas têm GRANT UPDATE. */
export type StoreUpdatePatch = Partial<Pick<StoresRow,
  'name' | 'title' | 'subtitle' | 'slug' | 'cnpj' | 'email' | 'whatsapp_number' |
  'logo_path' | 'banner_path' | 'primary_color' | 'secondary_color' | 'social_links' | 'is_published'>>

/** UPDATE direto em public.profiles (somente a própria linha). */
export type ProfileUpdatePatch = Partial<Pick<ProfilesRow, 'full_name' | 'phone' | 'avatar_path'>>

// ---------- Catálogo ----------
export interface CategoryInput {
  name: string                 // 2..100 (trim)
  slug?: string | null         // 2..100; omitido/'' => gerado de name (sem acentos)
  parent_id?: Uuid | null      // no máximo 2 níveis
  is_active?: boolean          // default true
  sort_order?: number          // inteiro 0..1000000; default 0
}
export type CategoryPatch = Partial<CategoryInput>   // chave ausente = mantém; parent_id null = raiz
export interface CreateCategoryArgs { p_store_id: Uuid; p_request_id: Uuid; p_input: CategoryInput }
export interface CreateCategoryResult { category_id: Uuid; code: string; slug: string; created: boolean }
export interface UpdateCategoryArgs { p_category_id: Uuid; p_patch: CategoryPatch }
export interface UpdateCategoryResult { category_id: Uuid; updated_at: IsoDateTime }
export interface ArchiveCategoryArgs { p_category_id: Uuid }
export interface ArchiveCategoryResult { category_id: Uuid; archived: true; already_archived: boolean }

export interface ProductInput {
  name: string                 // 2..160 (trim)
  price: number                // obrigatório; 0..9999999999.99; no máximo 2 casas
  slug?: string | null         // 2..160; omitido/'' => gerado de name
  description?: string | null  // <= 10000; texto simples
  category_id?: Uuid | null
  status?: ProductStatus | null   // default 'INACTIVE'
  cost_price?: number          // default 0; custo de REFERÊNCIA (não é CMV)
  is_featured?: boolean        // default false
  attributes?: ProductAttributeInput[]  // <= 30; nomes únicos (case-insensitive)
}
export type ProductPatch = Partial<ProductInput>      // 'attributes' presente => SUBSTITUI todos
export interface CreateProductArgs { p_store_id: Uuid; p_request_id: Uuid; p_input: ProductInput }
export interface CreateProductResult { product_id: Uuid; code: string; slug: string; created: boolean }
export interface UpdateProductArgs { p_product_id: Uuid; p_patch: ProductPatch }
export interface UpdateProductResult { product_id: Uuid; updated_at: IsoDateTime; status: ProductStatus }
export interface ArchiveProductArgs { p_product_id: Uuid }
export interface ArchiveProductResult { product_id: Uuid; archived: true; already_archived: boolean }
export interface ReplaceProductAttributesArgs { p_product_id: Uuid; p_attributes: ProductAttributeInput[] }
export interface ReplaceProductAttributesResult { product_id: Uuid; count: number }

export interface AttachProductImageArgs { p_product_id: Uuid; p_path: string; p_alt_text?: string }
export interface AttachProductImageResult { image_id: Uuid; sort_order: 0 | 1 | 2 | 3; created: boolean }
export interface DetachProductImageArgs { p_product_id: Uuid; p_image_id: Uuid }
export interface DetachProductImageResult { product_id: Uuid; image_id: Uuid; detached: boolean; path: string | null }
export interface ReorderProductImagesArgs { p_product_id: Uuid; p_image_ids: Uuid[] }  // TODOS os ids vinculados
export interface ReorderProductImagesResult { product_id: Uuid; count: number }

// ---------- Estoque ----------
export interface InventoryMovementResult {
  movement_id: Uuid
  product_id: Uuid
  movement_type: InventoryMovementType
  quantity_delta: number
  quantity: number             // saldo após
  stock_value: number          // numeric(26,6)
  average_cost: number         // numeric(18,6)
  revision: number             // bigint
  replayed: boolean
}
export interface RegisterInventoryMovementArgs {
  p_product_id: Uuid; p_request_id: Uuid
  p_type: 'ENTRY' | 'EXIT'
  p_quantity: number           // inteiro 1..1000000000
  p_reason: string             // 3..500
  p_unit_cost?: number | null  // OBRIGATÓRIO em ENTRY (0..9999999999.999999, <=6 casas); PROIBIDO em EXIT
  p_reference?: string | null  // <= 120
}
export interface AdjustInventoryCountArgs {
  p_product_id: Uuid; p_request_id: Uuid
  p_counted_quantity: number   // inteiro 0..1000000000
  p_expected_revision: number  // product_stock_balances.revision lido na tela
  p_reason: string
  p_unit_cost?: number | null  // só quando a contagem AUMENTA o saldo
  p_reference?: string | null
}
export type AdjustInventoryCountResult =
  | { product_id: Uuid; quantity: number; stock_value: number; average_cost: number; revision: number; changed: false; replayed: boolean }
  | (InventoryMovementResult & { changed: true })

export interface AdjustBatchItem {
  product_id: Uuid
  counted_quantity: number
  expected_revision: number
  unit_cost?: number | null
}
export interface AdjustInventoryBatchArgs {
  p_store_id: Uuid; p_request_id: Uuid
  p_items: AdjustBatchItem[]   // 1..50, sem produto repetido, <= 32 KiB
  p_reason: string
  p_reference?: string | null
}
export interface AdjustInventoryBatchResult {
  store_id: Uuid
  request_id: Uuid
  items: Array<
    | { product_id: Uuid; quantity: number; stock_value: number; average_cost: number; revision: number; changed: false }
    | (InventoryMovementResult & { changed: true })
  >
  replayed: boolean
}
export interface ReverseInventoryMovementArgs { p_movement_id: Uuid; p_request_id: Uuid; p_reason: string }
export type ReverseInventoryMovementResult = InventoryMovementResult   // movement_type = 'REVERSAL'

// ---------- Pedidos (lojista) ----------
export interface OrderOperationResult {
  order_id: Uuid
  status: OrderStatus
  revision: number
  subtotal: number
  shipping_amount: number
  shipping_confirmed: boolean
  total: number
  replayed: boolean
}
interface OrderOpBase { p_order_id: Uuid; p_request_id: Uuid; p_expected_revision: number }
export interface UpdateOrderTermsArgs extends OrderOpBase { p_shipping_amount: number; p_note: string }
export interface ConfirmOrderPaymentArgs extends OrderOpBase {
  p_amount: number             // DEVE ser igual a orders.total
  p_method: ManualMethod
  p_note: string               // 3..1000
  p_reference?: string | null  // <= 160
}
export interface ShipOrderArgs extends OrderOpBase { p_note: string; p_tracking_code?: string | null }  // <= 120
export interface DeliverOrderArgs extends OrderOpBase { p_note: string }
export interface CancelOrderArgs extends OrderOpBase {
  p_note: string
  p_refund_confirmed?: boolean        // PENDING: false/omitido | PAID: true
  p_refund_method?: ManualMethod | null   // PENDING: null | PAID: obrigatório
  p_refund_reference?: string | null      // PENDING: null
}
export interface ReturnOrderItem { order_item_id: Uuid; disposition: ReturnDisposition }
export interface ReturnOrderArgs extends OrderOpBase {
  p_items: ReturnOrderItem[]   // TODOS os itens do pedido (devolução integral), 1..20
  p_goods_received: boolean    // deve ser true
  p_refund_confirmed: boolean  // deve ser true (declaração)
  p_refund_method: ManualMethod
  p_note: string
  p_refund_reference?: string | null
}

// ---------- Despesas ----------
export interface CreateExpenseCategoryArgs {
  p_store_id: Uuid; p_request_id: Uuid; p_name: string; p_classification: ExpenseClassification
}
export interface CreateExpenseCategoryResult {
  category_id: Uuid; name: string; classification: ExpenseClassification; replayed: boolean
}
export interface UpdateExpenseCategoryArgs { p_category_id: Uuid; p_request_id: Uuid; p_name: string; p_active: boolean }
export interface UpdateExpenseCategoryResult { category_id: Uuid; name: string; is_active: boolean; replayed: boolean }
export interface RecordExpenseArgs {
  p_store_id: Uuid; p_request_id: Uuid; p_category_id: Uuid
  p_amount: number                     // > 0, <= 9999999999.99, 2 casas
  p_method: ManualMethod
  p_description: string                // 3..500
  p_occurred_at: IsoDateTime           // >= 2000-01-01 e <= agora + 5 min (somente despesa JÁ PAGA)
  p_reference?: string | null          // <= 160
  p_inventory_movement_id?: Uuid | null  // só categoria INVENTORY_PURCHASE + movimento ENTRY manual
}
export interface RecordExpenseResult {
  expense_id: Uuid; amount: number; classification: ExpenseClassification; occurred_at: IsoDateTime; replayed: boolean
}
export interface ReverseExpenseArgs {
  p_expense_id: Uuid; p_request_id: Uuid
  p_kind: 'CORRECTION' | 'REFUND'
  p_description: string
  p_occurred_at?: IsoDateTime | null   // CORRECTION: null | REFUND: obrigatório (>= data original)
  p_method?: ManualMethod | null       // CORRECTION: null | REFUND: obrigatório
  p_reference?: string | null          // CORRECTION: null
}
export interface ReverseExpenseResult {
  expense_id: Uuid; reversal_of_id: Uuid; kind: 'CORRECTION' | 'REFUND'; amount: number; occurred_at: IsoDateTime; replayed: boolean
}

// ---------- ERP ----------
export interface ErpPeriodArgs {
  p_store_id: Uuid
  p_from: IsoDate          // inclusivo
  p_to: IsoDate            // inclusivo; p_to - p_from <= 365 (=> até 366 dias)
  p_timezone?: string      // default 'America/Sao_Paulo'; deve existir em pg_timezone_names
}
export interface ErpSummary {
  store_id: Uuid; from: IsoDate; to: IsoDate; timezone: string
  net_goods_revenue: number; net_shipping_revenue: number; net_revenue: number
  net_cogs: number; returned_damage_loss: number; inventory_adjustment_cost: number
  net_operating_expenses: number; net_inventory_purchase_cash: number
  gross_margin: number; estimated_operating_result: number
  operating_margin_percent: number | null
  cash_received: number; cash_paid_net: number; net_cash_flow: number
  receipt_count: number; refund_count: number; units_sold: number; units_restocked: number
  average_receipt: number | null
  unclassified_stock_outbound_value: number; unclassified_stock_event_count: number
  needs_stock_review: boolean
  is_estimate: true
  accounting_basis: 'manual_cash_based_management'
  inventory_snapshot_current: { quantity: number; stock_value: number; reserved_quantity: number }
  warnings: string[]
}
export interface ErpDay {
  date: IsoDate
  net_revenue: number; net_cogs: number; returned_damage_loss: number
  net_operating_expenses: number; inventory_adjustment_cost: number
  estimated_operating_result: number
  cash_received: number; cash_paid_net: number; net_cash_flow: number
}
export interface ErpDaily { from: IsoDate; to: IsoDate; timezone: string; days: ErpDay[] }
export interface ErpProductPerformanceArgs extends ErpPeriodArgs { p_limit?: number }   // 1..100, default 20
export interface ErpProductRow {
  product_id: Uuid; code: string; name_snapshot: string
  net_units: number; net_goods_revenue: number; net_cogs: number; damage_loss: number
  contribution_before_shared_expenses: number
}
export interface ErpProductPerformance { from: IsoDate; to: IsoDate; products: ErpProductRow[]; note: string }
export interface ErpExpenseBreakdown {
  from: IsoDate; to: IsoDate
  categories: Array<{ category_id: Uuid; name_snapshot: string; classification: ExpenseClassification; net_amount: number }>
}
