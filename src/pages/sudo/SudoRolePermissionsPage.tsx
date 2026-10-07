import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Grid3X3, Info } from 'lucide-react'
import { sudoService } from '@/services/sudo.service'
import { plansService } from '@/services/plans.service'
import { toastError, toastSuccess } from '@/lib/feedback'
import { brl } from '@/lib/money'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { TableSkeleton, ErrorRetryState, EmptyState } from '@/components/shared/page-state'
import { FormField } from '@/components/shared/form'
import type { RolesRow, Uuid } from '@/types'

/**
 * /sudo/role-permissions (guia 18) — matriz papel × permissão.
 * Mudanças são imediatas e auditadas; desativar security.manage/auth.access
 * do SUDO pode bloquear o painel (recuperação só via SQL Editor).
 */
export default function SudoRolePermissionsPage() {
  const qc = useQueryClient()

  const rolesQ = useQuery({ queryKey: ['sudo', 'roles'], queryFn: () => sudoService.listRoles() })
  const permsQ = useQuery({
    queryKey: ['sudo', 'permissions'],
    queryFn: () => sudoService.listPermissions(),
  })
  const linksQ = useQuery({
    queryKey: ['sudo', 'role-permissions'],
    queryFn: () => sudoService.listRolePermissions(),
  })
  const plansQ = useQuery({ queryKey: ['sudo', 'plans'], queryFn: () => plansService.listAll() })

  const [activeRole, setActiveRole] = useState<Uuid | null>(null)

  const roles = rolesQ.data ?? []
  const permissions = permsQ.data ?? []
  const links = linksQ.data ?? []

  const currentRole = activeRole ?? roles.find((r) => r.code === 'OWNER')?.id ?? roles[0]?.id ?? null

  const enabledMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const l of links) m.set(`${l.role_id}:${l.permission_id}`, l.is_enabled)
    return m
  }, [links])

  const byModule = useMemo(() => {
    const groups = new Map<string, typeof permissions>()
    for (const p of permissions) {
      const list = groups.get(p.module) ?? []
      list.push(p)
      groups.set(p.module, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [permissions])

  const toggle = useMutation({
    mutationFn: ({ roleId, permId, enabled }: { roleId: Uuid; permId: Uuid; enabled: boolean }) =>
      sudoService.setRolePermission(roleId, permId, enabled),
    onSuccess: () => {
      toastSuccess('Matriz atualizada', 'A mudança já vale para as próximas chamadas.')
      void qc.invalidateQueries({ queryKey: ['sudo', 'role-permissions'] })
    },
    onError: (e) => toastError(e, 'Não foi possível alterar a permissão'),
  })

  const updatePlan = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name: string; description: string; is_active: boolean } }) =>
      plansService.updatePlan(id, patch),
    onSuccess: () => {
      toastSuccess('Plano atualizado')
      void qc.invalidateQueries({ queryKey: ['sudo', 'plans'] })
    },
    onError: (e) => toastError(e, 'Não foi possível salvar o plano'),
  })

  const loading = rolesQ.isLoading || permsQ.isLoading || linksQ.isLoading
  const failed = rolesQ.isError || permsQ.isError || linksQ.isError

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl font-semibold">Matriz de permissões</h1>
        <p className="mt-1 text-sm text-white/60">
          Ligue e desligue permissões por papel. Papéis customizados servem apenas como catálogo — a
          atribuição a usuários aceita somente USER e SUDO.
        </p>
      </div>

      <Alert className="border-amber-400/30 bg-amber-400/10 text-amber-100">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-amber-100">Cuidado com o papel SUDO</AlertTitle>
        <AlertDescription className="text-amber-100/80">
          Desativar <span className="font-mono">security.manage</span> ou{' '}
          <span className="font-mono">auth.access</span> do SUDO pode bloquear este painel. A
          recuperação exige acesso ao SQL Editor do Supabase.
        </AlertDescription>
      </Alert>

      {loading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : failed ? (
        <ErrorRetryState
          onRetry={() => {
            void rolesQ.refetch()
            void permsQ.refetch()
            void linksQ.refetch()
          }}
        />
      ) : roles.length === 0 || permissions.length === 0 ? (
        <EmptyState
          title="Sem papéis ou permissões"
          description="Cadastre papéis e permissões antes de montar a matriz."
        />
      ) : (
        <Card className="border-white/10 bg-white/5 text-white">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <Grid3X3 className="h-4 w-4 text-primary" />
                Papel
              </CardTitle>
              <CardDescription className="text-white/50">
                {permissions.length} permissões em {byModule.length} módulos
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r: RolesRow) => (
                <Button
                  key={r.id}
                  size="sm"
                  variant={r.id === currentRole ? 'default' : 'outline'}
                  className={
                    r.id === currentRole
                      ? 'bg-primary'
                      : 'border-white/15 bg-transparent text-white hover:bg-white/10'
                  }
                  onClick={() => setActiveRole(r.id)}
                >
                  <span className="font-mono text-xs">{r.code}</span>
                  {r.is_system && <span className="text-[10px] opacity-70">sys</span>}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {byModule.map(([module, perms]) => (
              <div key={module}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                  {module}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {perms.map((p) => {
                    const enabled = currentRole
                      ? (enabledMap.get(`${currentRole}:${p.id}`) ?? false)
                      : false
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 font-mono text-xs text-white/90">
                            {p.code}
                            {p.is_system && (
                              <Badge className="border-transparent bg-white/10 text-[10px] text-white/60">
                                sistema
                              </Badge>
                            )}
                          </p>
                          {p.description && (
                            <p className="mt-0.5 truncate text-xs text-white/45">{p.description}</p>
                          )}
                        </div>
                        <Switch
                          checked={enabled}
                          disabled={!currentRole || toggle.isPending}
                          onCheckedChange={(v) =>
                            currentRole && toggle.mutate({ roleId: currentRole, permId: p.id, enabled: v })
                          }
                        />
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Planos (guia 18) — UPDATE name/description/is_active requer SUDO + plans.manage */}
      <Card className="border-white/10 bg-white/5 text-white">
        <CardHeader>
          <CardTitle className="text-white">Planos</CardTitle>
          <CardDescription className="text-white/50">
            Desativar o plano FREE bloqueia novos cadastros de loja (PLAN_UNAVAILABLE).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(plansQ.data ?? []).map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              saving={updatePlan.isPending}
              onSave={(patch) => updatePlan.mutate({ id: plan.id, patch })}
            />
          ))}
          {plansQ.data?.length === 0 && (
            <p className="text-sm text-white/50">Nenhum plano cadastrado.</p>
          )}
          <p className="flex items-start gap-2 text-xs text-white/40">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            O plano do usuário comum só é visível quando está ativo.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function PlanRow({
  plan,
  saving,
  onSave,
}: {
  plan: { id: string; code: string; name: string; description: string; price: number; is_active: boolean }
  saving: boolean
  onSave: (patch: { name: string; description: string; is_active: boolean }) => void
}) {
  const [name, setName] = useState(plan.name)
  const [description, setDescription] = useState(plan.description)
  const [active, setActive] = useState(plan.is_active)
  const dirty = name !== plan.name || description !== plan.description || active !== plan.is_active

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-sm text-white/90">{plan.code}</span>
          <Badge className="border-transparent bg-white/10 text-white/70">{brl(plan.price)}/mês</Badge>
        </span>
        <label className="flex items-center gap-2 text-sm text-white/70">
          Ativo
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Nome">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border-white/15 bg-white/5 text-white"
          />
        </FormField>
        <FormField label="Descrição">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="border-white/15 bg-white/5 text-white"
          />
        </FormField>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => onSave({ name: name.trim(), description: description.trim(), is_active: active })}
        >
          Salvar alterações
        </Button>
      </div>
    </div>
  )
}
