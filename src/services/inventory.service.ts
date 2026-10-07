import { rpc, toBackendError, BackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { clearPending, stablePending } from '@/lib/pending'
import { startOfDayIso, addDays } from '@/lib/format'
import type {
  AdjustInventoryBatchArgs,
  AdjustInventoryBatchResult,
  AdjustInventoryCountArgs,
  AdjustInventoryCountResult,
  AdjustBatchItem,
  InventoryMovementsRow,
  InventoryMovementType,
  InventoryMovementResult,
  ProductStockBalancesRow,
  RegisterInventoryMovementArgs,
  ReverseInventoryMovementArgs,
  Uuid,
} from '@/types'

export interface BalanceFilters {
  search?: string
  onlyZero?: boolean
  onlyReserved?: boolean
  status?: 'ACTIVE' | 'INACTIVE' | ''
  page: number
  pageSize?: number
}

export interface MovementFilters {
  productId?: Uuid | null
  types?: InventoryMovementType[]
  from?: string // YYYY-MM-DD
  to?: string
  batch?: string | null
  page: number
  pageSize?: number
}

/** Estoque: saldos, movimentos, contagem e lote (guia 12). Ledger imutável; reserva ≠ baixa. */
export const inventoryService = {
  async listBalances(storeId: Uuid, f: BalanceFilters) {
    const pageSize = f.pageSize ?? 20
    let q = supabase
      .from('product_stock_balances')
      .select(
        'product_id, code, name, status, category_id, quantity, reserved_quantity, available_quantity, stock_value, average_cost, revision, updated_at',
        { count: 'exact' },
      )
      .eq('store_id', storeId)
    if (f.search) q = q.ilike('name', `%${f.search.replace(/[%_,()]/g, ' ').trim()}%`)
    if (f.onlyZero) q = q.eq('quantity', 0)
    if (f.onlyReserved) q = q.gt('reserved_quantity', 0)
    if (f.status) q = q.eq('status', f.status)
    const { data, count, error } = await q
      .order('name')
      .range((f.page - 1) * pageSize, f.page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as ProductStockBalancesRow[], total: count ?? 0, pageSize }
  },

  async listMovements(storeId: Uuid, f: MovementFilters) {
    const pageSize = f.pageSize ?? 20
    let q = supabase
      .from('inventory_movements')
      .select(
        `id, product_id, product_code, product_name, movement_type, quantity_delta, unit_cost,
         value_delta, quantity_before, quantity_after, average_cost_after, revision, reason,
         reference, reversal_of_id, batch_request_id, created_by, created_at`,
        { count: 'exact' },
      )
      .eq('store_id', storeId)
    if (f.productId) q = q.eq('product_id', f.productId)
    if (f.types?.length) q = q.in('movement_type', f.types)
    if (f.from) q = q.gte('created_at', startOfDayIso(f.from))
    if (f.to) q = q.lt('created_at', startOfDayIso(addDays(f.to, 1)))
    if (f.batch) q = q.eq('batch_request_id', f.batch)
    const { data, count, error } = await q
      .order('created_at', { ascending: false })
      .order('id')
      .range((f.page - 1) * pageSize, f.page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as InventoryMovementsRow[], total: count ?? 0, pageSize }
  },

  /** Entrada/saída manual. ENTRY exige custo unitário; EXIT o proíbe (custo automático). */
  async registerMovement(input: {
    productId: Uuid
    type: 'ENTRY' | 'EXIT'
    quantity: number
    reason: string
    unitCost?: number | null
    reference?: string | null
  }): Promise<InventoryMovementResult> {
    const key = `inv:${input.productId}:${input.type.toLowerCase()}`
    const op = stablePending(key, input)
    try {
      const r = await rpc<RegisterInventoryMovementArgs, InventoryMovementResult>(
        'register_inventory_movement',
        {
          p_product_id: input.productId,
          p_request_id: op.requestId,
          p_type: input.type,
          p_quantity: input.quantity,
          p_reason: input.reason.trim(),
          p_unit_cost: input.type === 'ENTRY' ? (input.unitCost ?? null) : null,
          p_reference: input.reference?.trim() || null,
        },
      )
      clearPending(key)
      return r
    } catch (e) {
      if (e instanceof BackendError && !e.isNetwork) clearPending(key)
      throw e
    }
  },

  /** Contagem individual com concorrência otimista (expected_revision lido na tela). */
  async adjustCount(input: {
    productId: Uuid
    countedQuantity: number
    expectedRevision: number
    reason: string
    unitCost?: number | null
    currentQuantity: number
    reference?: string | null
  }): Promise<AdjustInventoryCountResult> {
    const key = `inv:${input.productId}:count`
    const op = stablePending(key, input)
    try {
      const r = await rpc<AdjustInventoryCountArgs, AdjustInventoryCountResult>(
        'adjust_inventory_count',
        {
          p_product_id: input.productId,
          p_request_id: op.requestId,
          p_counted_quantity: input.countedQuantity,
          p_expected_revision: input.expectedRevision,
          p_reason: input.reason.trim(),
          p_unit_cost:
            input.countedQuantity > input.currentQuantity ? (input.unitCost ?? null) : null,
          p_reference: input.reference?.trim() || null,
        },
      )
      clearPending(key)
      return r
    } catch (e) {
      if (e instanceof BackendError) clearPending(key) // STALE → nova intenção após recarregar
      throw e
    }
  },

  /** Contagem em lote (atômico; até 50 itens, sem produto repetido). */
  async adjustBatch(storeId: Uuid, reason: string, items: AdjustBatchItem[], reference?: string) {
    const key = 'inv:batch'
    const op = stablePending(key, { storeId, reason, items, reference })
    try {
      const r = await rpc<AdjustInventoryBatchArgs, AdjustInventoryBatchResult>(
        'adjust_inventory_batch',
        {
          p_store_id: storeId,
          p_request_id: op.requestId,
          p_items: items,
          p_reason: reason.trim(),
          p_reference: reference?.trim() || null,
        },
      )
      clearPending(key)
      return r
    } catch (e) {
      if (e instanceof BackendError && !e.isNetwork) clearPending(key)
      throw e
    }
  },

  reverseMovement: (movementId: Uuid, reason: string) =>
    rpc<ReverseInventoryMovementArgs, InventoryMovementResult>('reverse_inventory_movement', {
      p_movement_id: movementId,
      p_request_id: crypto.randomUUID(),
      p_reason: reason.trim(),
    }),

  /** Elegibilidade de reversão: último movimento do produto, não-REVERSAL, sem reversão e sem vínculo com pedido. */
  async getReversalEligibility(storeId: Uuid, movementIds: Uuid[]) {
    if (movementIds.length === 0) return new Map<Uuid, boolean>()
    const [{ data: reversed }, { data: orderLinked }] = await Promise.all([
      supabase
        .from('inventory_movements')
        .select('reversal_of_id')
        .eq('store_id', storeId)
        .in('reversal_of_id', movementIds),
      supabase
        .from('order_stock_operations')
        .select('movement_id')
        .eq('store_id', storeId)
        .in('movement_id', movementIds),
    ])
    const reversedSet = new Set((reversed ?? []).map((r) => r.reversal_of_id as string))
    const orderSet = new Set((orderLinked ?? []).map((r) => r.movement_id as string))
    return new Map(
      movementIds.map((id) => [id, !reversedSet.has(id) && !orderSet.has(id)] as const),
    )
  },
}
