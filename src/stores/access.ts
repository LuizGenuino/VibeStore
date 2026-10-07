import { create } from 'zustand'
import { rpc, toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type { MyAccess, StoreAccess } from '@/types/rpc'
import type { PermissionCode, StoresRow } from '@/types/backend'
import { registerAccessInvalidator } from './auth'

interface AccessState {
  my: MyAccess | null
  store: StoresRow | null
  storeAccess: StoreAccess
  loading: Promise<void> | null
  ensureLoaded: () => Promise<void>
  reload: () => Promise<void>
  reset: () => void
}

export const useAccessStore = create<AccessState>((set, get) => ({
  my: null,
  store: null,
  storeAccess: null,
  loading: null,

  ensureLoaded() {
    return get().loading ?? get().reload()
  },

  async reload() {
    const p = (async () => {
      const my = await rpc<object, MyAccess>('get_my_access')
      set({ my })
      // Loja própria: no máximo UMA não arquivada (índice stores_one_live_per_owner).
      // Filtrar por owner_id evita listar lojas de terceiros quando o usuário é SUDO.
      if (my.user_id) {
        const { data, error } = await supabase
          .from('stores')
          .select('*')
          .eq('owner_id', my.user_id)
          .is('archived_at', null)
          .maybeSingle()
        if (error) throw toBackendError(error)
        set({ store: data as StoresRow | null })
        if (data) {
          const storeAccess = await rpc<{ p_store_id: string }, StoreAccess>('get_store_access', {
            p_store_id: data.id,
          })
          set({ storeAccess })
        } else {
          set({ storeAccess: null })
        }
      }
    })().finally(() => set({ loading: null }))
    set({ loading: p })
    return p
  },

  reset() {
    set({ my: null, store: null, storeAccess: null, loading: null })
  },
}))

// Invalidação de cache em eventos de auth (guia 6.2).
registerAccessInvalidator((event) => {
  const access = useAccessStore.getState()
  if (event === 'SIGNED_OUT') {
    access.reset()
  } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
    useAccessStore.setState({ loading: null }) // força novo get_my_access na próxima rota
  }
})

// ---- Seletores derivados -------------------------------------------------
export const useStoreId = () => useAccessStore((s) => s.store?.id ?? null)
export const useMyAccess = () => useAccessStore((s) => s.my)
export const useActiveStore = () => useAccessStore((s) => s.store)
export const useStoreAccess = () => useAccessStore((s) => s.storeAccess)

/** Permissão GLOBAL (via user_platform_roles). */
export const useCan = (p: PermissionCode) =>
  useAccessStore((s) => !!s.my?.permissions.includes(p))
/** Permissão efetiva NA LOJA (get_store_access). */
export const useHasStorePerm = (p: PermissionCode) =>
  useAccessStore((s) => !!s.storeAccess?.permissions.includes(p))
export const useIsSudo = () => useAccessStore((s) => !!s.my?.can_manage_security)

export const hasStorePerm = (p: PermissionCode) =>
  !!useAccessStore.getState().storeAccess?.permissions.includes(p)
