import { toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type { PlansRow } from '@/types/backend'

/** Planos (guia 8.1 / 18): usuário comum só enxerga ativos; SUDO edita nome/descrição/ativo. */
export const plansService = {
  async listActiveFree(): Promise<PlansRow[]> {
    const { data, error } = await supabase
      .from('plans')
      .select('id, code, name, description, price, currency, is_active')
      .eq('is_active', true)
      .eq('code', 'FREE')
    if (error) throw toBackendError(error)
    return (data ?? []) as PlansRow[]
  },

  async listAll(): Promise<PlansRow[]> {
    const { data, error } = await supabase.from('plans').select('*').order('created_at')
    if (error) throw toBackendError(error)
    return (data ?? []) as PlansRow[]
  },

  async updatePlan(id: string, patch: Pick<PlansRow, 'name' | 'description' | 'is_active'>) {
    const { data, error } = await supabase.from('plans').update(patch).eq('id', id).select()
    if (error) throw toBackendError(error)
    return data?.[0] as PlansRow | undefined
  },
}
