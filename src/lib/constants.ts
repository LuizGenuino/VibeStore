import type {
  InventoryMovementType,
  ManualMethod,
  OrderEventType,
  OrderStatus,
  ProductStatus,
} from '@/types/backend'

/** UFs para o checkout (27). */
export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

export const PAYMENT_METHOD_LABELS: Record<ManualMethod, string> = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  BANK_TRANSFER: 'Transferência',
  CARD: 'Cartão',
  OTHER: 'Outro',
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  RETURNED: 'Devolvido',
  CANCELLED: 'Cancelado',
}

/** Cores semânticas do pipeline de pedidos (chip). */
export const ORDER_STATUS_TONES: Record<
  OrderStatus,
  'warning' | 'info' | 'primary' | 'success' | 'muted' | 'destructive'
> = {
  PENDING: 'warning',
  PAID: 'info',
  SHIPPED: 'primary',
  DELIVERED: 'success',
  RETURNED: 'muted',
  CANCELLED: 'destructive',
}

export const ORDER_EVENT_LABELS: Record<OrderEventType, string> = {
  CREATED: 'Pedido criado',
  TERMS_UPDATED: 'Frete atualizado',
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  SHIPPED: 'Pedido enviado',
  DELIVERED: 'Pedido entregue',
  CANCELLED: 'Pedido cancelado',
  RETURNED: 'Pedido devolvido',
}

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  ADJUSTMENT_IN: 'Ajuste (+)',
  ADJUSTMENT_OUT: 'Ajuste (−)',
  REVERSAL: 'Reversão',
}

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
}

export const EXPENSE_KIND_LABELS = {
  EXPENSE: 'Despesa',
  CORRECTION: 'Correção',
  REFUND: 'Reembolso',
} as const

export const EXPENSE_CLASSIFICATION_LABELS = {
  OPERATING: 'Operacional',
  INVENTORY_PURCHASE: 'Compra de estoque',
} as const

export const APP_NAME = 'VibeStore'
export const APP_URL = (import.meta.env.VITE_APP_URL as string) || window.location.origin
export const STOREFRONT_API_URL =
  (import.meta.env.VITE_STOREFRONT_API_URL as string) ||
  `${import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL}/functions/v1/storefront-api`
