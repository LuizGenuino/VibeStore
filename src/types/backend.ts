// ============================================================
// src/types/backend.ts (PROPOSTA) — tipos base do contrato 001..007
// ============================================================
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type Uuid = string
export type IsoDateTime = string        // timestamptz serializado (ISO 8601)
export type IsoDate = string            // 'YYYY-MM-DD' (parâmetros date do ERP)

export type ProductStatus = 'ACTIVE' | 'INACTIVE'
export type InventoryMovementType = 'ENTRY' | 'EXIT' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT' | 'REVERSAL'
export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'RETURNED' | 'CANCELLED'
export type OrderEventType =
  | 'CREATED' | 'TERMS_UPDATED' | 'PAYMENT_CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED'
export type ManualMethod = 'PIX' | 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER'
export type ReturnDisposition = 'RESTOCKED' | 'DAMAGED'
export type ExpenseClassification = 'OPERATING' | 'INVENTORY_PURCHASE'
export type ExpenseKind = 'EXPENSE' | 'CORRECTION' | 'REFUND'
export type PlatformRole = 'USER' | 'SUDO'          // user_platform_roles aceita somente estes
export type StoreContextRole = 'OWNER' | 'SUDO'     // retornado por get_store_access

export type PermissionCode =
  | 'auth.access' | 'profile.update' | 'security.manage'
  | 'plans.read' | 'plans.manage'
  | 'store.create' | 'store.read' | 'store.update' | 'store.publish' | 'store.archive'
  | 'store.branding.manage' | 'store.admin'
  | 'catalog.read' | 'catalog.categories.manage' | 'catalog.products.manage' | 'catalog.products.media'
  | 'inventory.read' | 'inventory.entry' | 'inventory.exit' | 'inventory.adjust' | 'inventory.reverse'
  | 'storefront.read' | 'orders.create' | 'orders.read' | 'customers.read'
  | 'orders.terms' | 'orders.pay' | 'orders.ship' | 'orders.deliver' | 'orders.cancel' | 'orders.return'
  | 'expenses.read' | 'expenses.categories.manage' | 'expenses.record' | 'expenses.reverse'
  | 'reports.read'

/** Chaves aceitas por private.valid_social_links: valor https://..., <= 2048 chars */
export interface SocialLinks {
  instagram?: string
  facebook?: string
  tiktok?: string
  youtube?: string
  website?: string
}
export interface ProductAttributeInput { name: string; value: string }   // name 1..80, value 1..500 (após trim)
export interface CustomerSnapshot { full_name: string; phone: string }
export interface DeliveryAddress {
  postal_code: string      // 8 dígitos, sem hífen
  street: string
  number: string
  complement?: string      // opcional, <= 160
  district: string
  city: string
  state: string            // UF em maiúsculas, 2 letras
}
export interface StoreSnapshot { name: string; slug: string; whatsapp_number: string }

// ---------- Linhas das 25 tabelas/views (geradas do manifesto) ----------
/** public.categories */
export interface CategoriesRow {
  id: string
  store_id: string
  parent_id: string | null
  code: string
  name: string
  slug: string
  is_active: boolean
  sort_order: number
  request_id: string
  request_payload: Json
  created_at: string
  updated_at: string
  archived_at: string | null
}

/** public.customers */
export interface CustomersRow {
  id: string
  store_id: string
  phone: string
  full_name: string
  created_at: string
  updated_at: string
}

/** public.expense_categories */
export interface ExpenseCategoriesRow {
  id: string
  store_id: string
  name: string
  classification: ExpenseClassification
  is_active: boolean
  request_id: string
  request_payload: Json
  created_at: string
  updated_at: string
}

/** public.expense_entries */
export interface ExpenseEntriesRow {
  id: string
  store_id: string
  category_id: string
  category_name_snapshot: string
  classification: ExpenseClassification
  kind: ExpenseKind
  amount: number  // numeric
  method: ManualMethod
  description: string
  external_reference: string | null
  occurred_at: string
  recorded_at: string
  recorded_by: string
  request_id: string
  inventory_movement_id: string | null
  reversal_of_id: string | null
}

/** public.inventory_balances */
export interface InventoryBalancesRow {
  product_id: string
  store_id: string
  quantity: number
  stock_value: number  // numeric
  average_cost: number | null  // numeric, GENERATED
  revision: number  // bigint
  last_movement_id: string | null
  created_at: string
  updated_at: string
}

/** public.inventory_movements */
export interface InventoryMovementsRow {
  id: string
  store_id: string
  product_id: string
  product_code: string
  product_name: string
  request_id: string
  batch_request_id: string | null
  movement_type: InventoryMovementType
  quantity_delta: number
  unit_cost: number  // numeric
  value_delta: number  // numeric
  quantity_before: number
  quantity_after: number
  value_before: number  // numeric
  value_after: number  // numeric
  average_cost_before: number  // numeric
  average_cost_after: number  // numeric
  revision: number  // bigint
  reason: string
  reference: string | null
  reversal_of_id: string | null
  created_by: string
  created_at: string
}

/** public.inventory_reservations */
export interface InventoryReservationsRow {
  id: string
  store_id: string
  product_id: string
  order_id: string
  quantity: number
  state: 'HELD' | 'RELEASED' | 'CONSUMED'
  expires_at: string
  created_at: string
}

/** public.order_items */
export interface OrderItemsRow {
  id: string
  store_id: string
  order_id: string
  product_id: string
  product_code: string
  product_name: string
  product_slug: string
  image_path: string | null
  attributes_snapshot: ProductAttributeInput[]
  quantity: number
  unit_price: number  // numeric
  unit_cost_snapshot: number  // numeric
  line_total: number  // numeric
}

/** public.order_payments */
export interface OrderPaymentsRow {
  id: string
  store_id: string
  order_id: string
  kind: 'RECEIPT' | 'REFUND'
  method: ManualMethod
  amount: number  // numeric
  external_reference: string | null
  note: string
  confirmed_by: string
  confirmed_at: string
  request_id: string
}

/** public.order_return_items */
export interface OrderReturnItemsRow {
  id: string
  store_id: string
  order_id: string
  order_item_id: string
  disposition: ReturnDisposition
  quantity: number
  allocated_cost: number  // numeric
  restocked_value: number  // numeric
  loss_value: number  // numeric
  note: string
  created_at: string
}

/** public.order_status_history */
export interface OrderStatusHistoryRow {
  id: string
  store_id: string
  order_id: string
  revision: number  // bigint
  event_type: OrderEventType
  status_before: OrderStatus | null
  status_after: OrderStatus
  note: string
  actor_id: string | null
  request_id: string
  created_at: string
}

/** public.order_stock_operations */
export interface OrderStockOperationsRow {
  id: string
  store_id: string
  order_id: string
  order_item_id: string
  kind: 'SALE' | 'RESTOCK'
  movement_id: string
  quantity: number
  allocated_value: number  // numeric
  created_at: string
}

/** public.orders */
export interface OrdersRow {
  id: string
  store_id: string
  customer_id: string
  code: string
  status: OrderStatus
  request_id: string
  request_payload: Json
  customer_snapshot: CustomerSnapshot
  delivery_address: DeliveryAddress
  store_snapshot: StoreSnapshot
  customer_note: string
  payment_method: 'WHATSAPP'
  subtotal: number  // numeric
  total: number  // numeric
  reservation_expires_at: string
  created_at: string
  updated_at: string
  revision: number  // bigint
  shipping_amount: number  // numeric
  shipping_confirmed: boolean
  tracking_code: string | null
  paid_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  returned_at: string | null
}

/** public.permissions */
export interface PermissionsRow {
  id: string
  code: string
  module: string
  description: string
  is_system: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

/** public.plans */
export interface PlansRow {
  id: string
  code: 'FREE'
  name: string
  description: string
  price: number  // numeric
  currency: 'BRL'
  is_active: boolean
  created_at: string
  updated_at: string
}

/** public.product_attributes */
export interface ProductAttributesRow {
  id: string
  store_id: string
  product_id: string
  name: string
  name_key: string | null  // GENERATED
  value: string
  sort_order: number
  created_at: string
  updated_at: string
}

/** public.product_images */
export interface ProductImagesRow {
  id: string
  store_id: string
  product_id: string
  path: string
  alt_text: string
  sort_order: number
  created_at: string
  updated_at: string
}

/** public.product_stock_balances */
export interface ProductStockBalancesRow {
  product_id: string | null
  store_id: string | null
  code: string | null
  name: string | null
  status: ProductStatus | null
  category_id: string | null
  quantity: number | null
  stock_value: number | null  // numeric
  average_cost: number | null  // numeric
  revision: number | null  // bigint
  last_movement_id: string | null
  updated_at: string | null
  reserved_quantity: number | null
  available_quantity: number | null
}

/** public.products */
export interface ProductsRow {
  id: string
  store_id: string
  category_id: string | null
  code: string
  name: string
  slug: string
  description: string
  status: ProductStatus
  price: number  // numeric
  cost_price: number  // numeric
  is_featured: boolean
  request_id: string
  request_payload: Json
  created_at: string
  updated_at: string
  archived_at: string | null
}

/** public.profiles */
export interface ProfilesRow {
  id: string
  full_name: string
  phone: string | null
  avatar_path: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** public.role_permissions */
export interface RolePermissionsRow {
  role_id: string
  permission_id: string
  is_enabled: boolean
  created_at: string
  updated_at: string
}

/** public.roles */
export interface RolesRow {
  id: string
  code: string
  name: string
  description: string
  is_system: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

/** public.security_audit_logs */
export interface SecurityAuditLogsRow {
  id: number  // bigint
  actor_id: string | null
  table_name: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  row_before: Json | null
  row_after: Json | null
  created_at: string
}

/** public.stores */
export interface StoresRow {
  id: string
  owner_id: string
  plan_id: string
  name: string
  title: string
  subtitle: string
  slug: string
  cnpj: string | null
  email: string | null
  whatsapp_number: string
  logo_path: string | null
  banner_path: string | null
  primary_color: string
  secondary_color: string
  social_links: SocialLinks
  is_published: boolean
  onboarding_request_id: string
  onboarding_payload: Json
  created_at: string
  updated_at: string
  archived_at: string | null
}

/** public.user_platform_roles */
export interface UserPlatformRolesRow {
  user_id: string
  role_code: 'USER' | 'SUDO'
  created_at: string
}
