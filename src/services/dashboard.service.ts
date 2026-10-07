import { toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type { Uuid } from '@/types'

/**
 * Blocos do Dashboard (guia 17) — cada consulta é condicionada à permissão
 * na página; aqui ficam apenas as contagens reutilizáveis.
 */
export const dashboardService = {
  async countPendingOrders(storeId: Uuid) {
    const { count, error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'PENDING')
    if (error) throw toBackendError(error)
    return count ?? 0
  },

  async countPaidOrders(storeId: Uuid) {
    const { count, error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'PAID')
    if (error) throw toBackendError(error)
    return count ?? 0
  },

  async countExpiredReservations(storeId: Uuid) {
    const { count, error } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('status', 'PENDING')
      .lt('reservation_expires_at', new Date().toISOString())
    if (error) throw toBackendError(error)
    return count ?? 0
  },

  async listLowStock(storeId: Uuid, maxAvailable = 3) {
    const { data, error } = await supabase
      .from('product_stock_balances')
      .select('product_id, code, name, quantity, reserved_quantity, available_quantity')
      .eq('store_id', storeId)
      .lte('available_quantity', maxAvailable)
      .order('available_quantity')
      .limit(10)
    if (error) throw toBackendError(error)
    return data ?? []
  },

  async countCategories(storeId: Uuid) {
    const { count, error } = await supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
    if (error) throw toBackendError(error)
    return count ?? 0
  },

  async countProducts(storeId: Uuid, status?: 'ACTIVE' | 'INACTIVE') {
    let q = supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
    if (status) q = q.eq('status', status)
    const { count, error } = await q
    if (error) throw toBackendError(error)
    return count ?? 0
  },

  async countProductsWithStock(storeId: Uuid) {
    const { count, error } = await supabase
      .from('product_stock_balances')
      .select('product_id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .gt('quantity', 0)
    if (error) throw toBackendError(error)
    return count ?? 0
  },
}
