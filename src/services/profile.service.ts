import { BackendError, toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type { ProfilesRow, ProfileUpdatePatch, Uuid } from '@/types'

/** Próprio perfil (guia 7.2) — profiles tem UPDATE direto só da própria linha. */
export const profileService = {
  async getMyProfile(userId: Uuid): Promise<ProfilesRow | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, avatar_path, is_active, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw toBackendError(error)
    return data as ProfilesRow | null
  },

  async updateMyProfile(userId: Uuid, patch: ProfileUpdatePatch): Promise<ProfilesRow> {
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select()
    if (error) throw toBackendError(error)
    if (!data?.length) throw new BackendError('FORBIDDEN', '42501') // UPDATE negado por RLS retorna 0 linhas
    return data[0] as ProfilesRow
  },
}
