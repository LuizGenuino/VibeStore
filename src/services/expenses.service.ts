import { rpc, toBackendError, BackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { clearPending, stablePending } from '@/lib/pending'
import { startOfDayIso, addDays } from '@/lib/format'
import type {
  CreateExpenseCategoryArgs,
  CreateExpenseCategoryResult,
  ExpenseCategoriesRow,
  ExpenseClassification,
  ExpenseEntriesRow,
  ExpenseKind,
  ManualMethod,
  RecordExpenseArgs,
  RecordExpenseResult,
  ReverseExpenseArgs,
  ReverseExpenseResult,
  Uuid,
  UpdateExpenseCategoryArgs,
  UpdateExpenseCategoryResult,
} from '@/types'

export interface ExpenseFilters {
  from: string // YYYY-MM-DD (obrigatório na lista)
  to: string
  categoryId?: Uuid | null
  kind?: ExpenseKind | ''
  page: number
  pageSize?: number
}

/** Despesas pagas (guia 15). Classificação da categoria é imutável; sem exclusão: desativar. */
export const expensesService = {
  async listCategories(storeId: Uuid): Promise<ExpenseCategoriesRow[]> {
    const { data, error } = await supabase
      .from('expense_categories')
      .select('id, name, classification, is_active, created_at, updated_at')
      .eq('store_id', storeId)
      .order('classification')
      .order('name')
    if (error) throw toBackendError(error)
    return (data ?? []) as ExpenseCategoriesRow[]
  },

  async createCategory(storeId: Uuid, name: string, classification: ExpenseClassification) {
    const op = stablePending('expense-category:new', { name, classification })
    const r = await rpc<CreateExpenseCategoryArgs, CreateExpenseCategoryResult>(
      'create_expense_category',
      { p_store_id: storeId, p_request_id: op.requestId, p_name: name.trim(), p_classification: classification },
    )
    clearPending('expense-category:new')
    return r
  },

  async updateCategory(categoryId: Uuid, name: string, active: boolean) {
    const op = stablePending(`expense-category:${categoryId}`, { name, active })
    const r = await rpc<UpdateExpenseCategoryArgs, UpdateExpenseCategoryResult>(
      'update_expense_category',
      { p_category_id: categoryId, p_request_id: op.requestId, p_name: name.trim(), p_active: active },
    )
    clearPending(`expense-category:${categoryId}`)
    return r
  },

  async listEntries(storeId: Uuid, f: ExpenseFilters) {
    const pageSize = f.pageSize ?? 20
    let q = supabase
      .from('expense_entries')
      .select(
        `id, category_id, category_name_snapshot, classification, kind, amount, method,
         description, external_reference, occurred_at, recorded_at, recorded_by,
         inventory_movement_id, reversal_of_id`,
        { count: 'exact' },
      )
      .eq('store_id', storeId)
      .gte('occurred_at', startOfDayIso(f.from))
      .lt('occurred_at', startOfDayIso(addDays(f.to, 1)))
    if (f.categoryId) q = q.eq('category_id', f.categoryId)
    if (f.kind) q = q.eq('kind', f.kind)
    const { data, count, error } = await q
      .order('occurred_at', { ascending: false })
      .order('id')
      .range((f.page - 1) * pageSize, f.page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as ExpenseEntriesRow[], total: count ?? 0, pageSize }
  },

  /** Ids de lançamentos já revertidos (para esconder o botão e mostrar o badge). */
  async getReversedIds(storeId: Uuid, entryIds: Uuid[]): Promise<Set<Uuid>> {
    if (entryIds.length === 0) return new Set()
    const { data, error } = await supabase
      .from('expense_entries')
      .select('reversal_of_id')
      .eq('store_id', storeId)
      .in('reversal_of_id', entryIds)
    if (error) throw toBackendError(error)
    return new Set((data ?? []).map((r) => r.reversal_of_id as string))
  },

  async recordExpense(input: {
    storeId: Uuid
    categoryId: Uuid
    amount: number
    method: ManualMethod
    description: string
    occurredAtLocal: string // datetime-local → converte do fuso local
    reference?: string
    inventoryMovementId?: Uuid | null
  }): Promise<RecordExpenseResult> {
    const key = 'expense:new'
    const op = stablePending(key, input)
    try {
      const r = await rpc<RecordExpenseArgs, RecordExpenseResult>('record_expense', {
        p_store_id: input.storeId,
        p_request_id: op.requestId,
        p_category_id: input.categoryId,
        p_amount: input.amount,
        p_method: input.method,
        p_description: input.description.trim(),
        p_occurred_at: new Date(input.occurredAtLocal).toISOString(),
        p_reference: input.reference?.trim() || null,
        p_inventory_movement_id: input.inventoryMovementId ?? null,
      })
      clearPending(key)
      return r
    } catch (e) {
      if (e instanceof BackendError && !e.isNetwork) clearPending(key)
      throw e
    }
  },

  /** ENTRY manuais elegíveis para vínculo com despesa de compra de estoque (guia 15.3). */
  async listEligibleStockPurchases(storeId: Uuid) {
    const { data: entries, error } = await supabase
      .from('inventory_movements')
      .select('id, product_name, quantity_delta, unit_cost, value_delta, reference, created_at')
      .eq('store_id', storeId)
      .eq('movement_type', 'ENTRY')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw toBackendError(error)
    const { data: linked } = await supabase
      .from('expense_entries')
      .select('inventory_movement_id')
      .eq('store_id', storeId)
      .not('inventory_movement_id', 'is', null)
    const linkedSet = new Set((linked ?? []).map((r) => r.inventory_movement_id as string))
    let orderSet = new Set<string>()
    try {
      const { data: fromOrders } = await supabase
        .from('order_stock_operations')
        .select('movement_id')
        .eq('store_id', storeId)
        .eq('kind', 'RESTOCK')
      orderSet = new Set((fromOrders ?? []).map((r) => r.movement_id as string))
    } catch {
      /* sem orders.read: ignora — o backend rejeita se inválido */
    }
    return (entries ?? []).filter(
      (e) => !linkedSet.has(e.id as string) && !orderSet.has(e.id as string),
    )
  },

  /** CORRECTION (anula na data original) ou REFUND (nova data, dinheiro devolvido de fato). */
  async reverseExpense(input: {
    expenseId: Uuid
    kind: 'CORRECTION' | 'REFUND'
    description: string
    occurredAtLocal?: string
    method?: ManualMethod
    reference?: string
  }): Promise<ReverseExpenseResult> {
    const key = `expense:${input.expenseId}:reverse`
    const op = stablePending(key, input)
    try {
      const r = await rpc<ReverseExpenseArgs, ReverseExpenseResult>('reverse_expense', {
        p_expense_id: input.expenseId,
        p_request_id: op.requestId,
        p_kind: input.kind,
        p_description: input.description.trim(),
        p_occurred_at:
          input.kind === 'REFUND' && input.occurredAtLocal
            ? new Date(input.occurredAtLocal).toISOString()
            : null,
        p_method: input.kind === 'REFUND' ? (input.method ?? null) : null,
        p_reference: input.kind === 'REFUND' ? input.reference?.trim() || null : null,
      })
      clearPending(key)
      return r
    } catch (e) {
      if (e instanceof BackendError && !e.isNetwork) clearPending(key)
      throw e
    }
  },
}
