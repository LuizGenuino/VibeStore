import { rpc, toBackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import type {
  PermissionsRow,
  ProfilesRow,
  RolePermissionsRow,
  RolesRow,
  SecurityAuditLogsRow,
  SudoSetUserActiveArgs,
  UserPlatformRolesRow,
  Uuid,
} from '@/types'

/**
 * Painel SUDO (guia 18). O papel SUDO só é atribuído via SQL Editor
 * (user_platform_roles não tem GRANT de escrita) — o painel apenas LÊ essa tabela.
 */
export const sudoService = {
  async listUsers(page: number, pageSize = 50) {
    const { data, count, error } = await supabase
      .from('profiles')
      .select('id, full_name, phone, is_active, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as ProfilesRow[], total: count ?? 0, pageSize }
  },

  async listPlatformRoles(userIds: Uuid[]) {
    if (userIds.length === 0) return [] as UserPlatformRolesRow[]
    const { data, error } = await supabase
      .from('user_platform_roles')
      .select('user_id, role_code, created_at')
      .in('user_id', userIds)
    if (error) throw toBackendError(error)
    return (data ?? []) as UserPlatformRolesRow[]
  },

  setUserActive: (userId: Uuid, active: boolean) =>
    rpc<SudoSetUserActiveArgs, null>('sudo_set_user_active', {
      p_user_id: userId,
      p_active: active,
    }),

  async listAuditLogs(page: number, pageSize = 100) {
    const { data, error } = await supabase
      .from('security_audit_logs')
      .select('id, actor_id, table_name, operation, row_before, row_after, created_at')
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)
    if (error) throw toBackendError(error)
    return (data ?? []) as SecurityAuditLogsRow[]
  },

  // ---- Papéis / permissões / matriz (CRUD direto — único domínio com GRANT) ----
  async listRoles() {
    const { data, error } = await supabase
      .from('roles')
      .select('id, code, name, description, is_system, is_active')
      .order('code')
    if (error) throw toBackendError(error)
    return (data ?? []) as RolesRow[]
  },

  async listPermissions() {
    const { data, error } = await supabase
      .from('permissions')
      .select('id, code, module, description, is_system, is_active')
      .order('module')
      .order('code')
    if (error) throw toBackendError(error)
    return (data ?? []) as PermissionsRow[]
  },

  async listRolePermissions() {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role_id, permission_id, is_enabled')
    if (error) throw toBackendError(error)
    return (data ?? []) as RolePermissionsRow[]
  },

  async insertRole(input: { code: string; name: string; description: string }) {
    const { data, error } = await supabase.from('roles').insert(input).select()
    if (error) throw toBackendError(error)
    return data?.[0] as RolesRow | undefined
  },

  async updateRole(id: Uuid, patch: Partial<Pick<RolesRow, 'name' | 'description' | 'is_active'>>) {
    const { data, error } = await supabase.from('roles').update(patch).eq('id', id).select()
    if (error) throw toBackendError(error)
    return data?.[0] as RolesRow | undefined
  },

  async deleteRole(id: Uuid) {
    const { error } = await supabase.from('roles').delete().eq('id', id)
    if (error) throw toBackendError(error)
  },

  async insertPermission(input: { code: string; module: string; description: string }) {
    const { data, error } = await supabase.from('permissions').insert(input).select()
    if (error) throw toBackendError(error)
    return data?.[0] as PermissionsRow | undefined
  },

  async updatePermission(
    id: Uuid,
    patch: Partial<Pick<PermissionsRow, 'module' | 'description' | 'is_active'>>,
  ) {
    const { data, error } = await supabase.from('permissions').update(patch).eq('id', id).select()
    if (error) throw toBackendError(error)
    return data?.[0] as PermissionsRow | undefined
  },

  async deletePermission(id: Uuid) {
    const { error } = await supabase.from('permissions').delete().eq('id', id)
    if (error) throw toBackendError(error)
  },

  async setRolePermission(roleId: Uuid, permissionId: Uuid, enabled: boolean) {
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ role_id: roleId, permission_id: permissionId, is_enabled: enabled })
      .select()
    if (error) throw toBackendError(error)
  },
}
