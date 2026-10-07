import { rpc } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type { MyAccess, StoreAccess } from '@/types/rpc'
import type { StoresRow, Uuid } from '@/types/backend'

/** Acesso global e por loja (guia 5.1 / 7.1). */
export const accessService = {
  getMyAccess: () => rpc<object, MyAccess>('get_my_access'),

  getStoreAccess: (storeId: Uuid) =>
    rpc<{ p_store_id: Uuid }, StoreAccess>('get_store_access', { p_store_id: storeId }),

  /** Loja ativa do usuário (no máximo 1 não arquivada por dono). */
  async getMyActiveStore(userId: Uuid): Promise<StoresRow | null> {
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .eq('owner_id', userId)
      .is('archived_at', null)
      .maybeSingle()
    if (error) throw error
    return data as StoresRow | null
  },
}
