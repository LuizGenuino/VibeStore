import { toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type { CustomersRow, OrdersRow, Uuid } from '@/types/backend'

/**
 * Clientes — SOMENTE LEITURA (guia 14). customers é criado/reaproveitado pelo
 * checkout por (store_id, phone); não há CRUD, edição, mesclagem ou exclusão.
 */
export const customersService = {
  async listCustomers(storeId: Uuid, term: string, page: number, pageSize = 20) {
    let q = supabase
      .from('customers')
      .select('id, full_name, phone, created_at, updated_at', { count: 'exact' })
      .eq('store_id', storeId)
    const t = term.replace(/[%_,()]/g, ' ').trim()
    if (t) q = q.or(`full_name.ilike.%${t}%,phone.ilike.%${t.replace(/\D/g, '')}%`)
    const { data, count, error } = await q
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as CustomersRow[], total: count ?? 0, pageSize }
  },

  /** Pedidos do cliente (painel lateral) — requer orders.read. */
  async listCustomerOrders(storeId: Uuid, customerId: Uuid) {
    const { data, error } = await supabase
      .from('orders')
      .select('id, code, status, total, created_at')
      .eq('store_id', storeId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw toBackendError(error)
    return (data ?? []) as Pick<OrdersRow, 'id' | 'code' | 'status' | 'total' | 'created_at'>[]
  },
}
