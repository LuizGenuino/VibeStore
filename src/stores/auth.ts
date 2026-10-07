import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Regra obrigatória (guia 6.2): NUNCA await supabase.… dentro do callback de
 * onAuthStateChange (deadlock do lock interno do SDK). Aqui só atualização
 * síncrona; trabalho assíncrono é agendado com setTimeout(…, 0).
 */

interface AuthState {
  session: Session | null
  user: User | null
  /** Promise que resolve quando o getSession() inicial terminou. */
  ready: Promise<void> | null
  /** Incrementa a cada SIGNED_IN/USER_UPDATED/SIGNED_OUT para invalidar caches de acesso. */
  epoch: number
  init: () => Promise<void>
  signOut: () => Promise<void>
}

type AccessInvalidator = (event: string) => void
let accessInvalidator: AccessInvalidator | null = null
/** Registrado pelo store de acesso para evitar dependência circular. */
export const registerAccessInvalidator = (fn: AccessInvalidator) => {
  accessInvalidator = fn
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  ready: null,
  epoch: 0,

  init() {
    if (get().ready) return get().ready!
    const ready = (async () => {
      const { data } = await supabase.auth.getSession() // FORA do callback: permitido
      set({ session: data.session, user: data.session?.user ?? null })
    })()
    set({ ready })

    supabase.auth.onAuthStateChange((event, session) => {
      // 1) SOMENTE atualização síncrona de estado aqui dentro
      set({ session, user: session?.user ?? null, epoch: get().epoch + 1 })
      // 2) Trabalho assíncrono agendado para FORA do callback
      setTimeout(() => {
        accessInvalidator?.(event)
        if (event === 'PASSWORD_RECOVERY') {
          window.history.replaceState(null, '', '/auth/reset-password')
          window.dispatchEvent(new PopStateEvent('popstate'))
        }
      }, 0)
    })
    return ready
  },

  async signOut() {
    await supabase.auth.signOut()
  },
}))
