import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { sudoService } from '@/services/sudo.service'
import { errorMessage, toastError, toastSuccess } from '@/lib/feedback'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { FormField } from '@/components/shared/form'
import { EmptyState, ErrorRetryState, TableSkeleton } from '@/components/shared/page-state'
import type { RolesRow } from '@/types/backend'

/**
 * SUDO — Papéis (guia 18): CRUD direto em roles (único domínio com GRANT).
 * is_system=true: sem excluir; code e is_system imutáveis
 * (SYSTEM_DEFINITION_RESERVED / SYSTEM_DEFINITION_CANNOT_BE_DELETED /
 * SECURITY_CODE_AND_SYSTEM_FLAG_IMMUTABLE chegam via toastError).
 * NUNCA há botão "tornar SUDO" — user_platform_roles é somente leitura.
 */

const CODE_RE = /^[A-Z][A-Z0-9_]{1,49}$/

interface RoleForm {
  code: string
  name: string
  description: string
}

const EMPTY: RoleForm = { code: '', name: '', description: '' }

export default function SudoRolesPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<RolesRow | null>(null) // null = fechado
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<RolesRow | null>(null)
  const [form, setForm] = useState<RoleForm>(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)

  const rolesQuery = useQuery({
    queryKey: ['sudo', 'roles'],
    queryFn: () => sudoService.listRoles(),
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['sudo', 'roles'] })

  const saveMutation = useMutation({
    mutationFn: async (input: RoleForm & { id?: string }) => {
      if (input.id) {
        // Edição: code e is_system NUNCA são enviados (imutáveis p/ sistema).
        return sudoService.updateRole(input.id, {
          name: input.name.trim(),
          description: input.description.trim(),
        })
      }
      return sudoService.insertRole({
        code: input.code.trim(),
        name: input.name.trim(),
        description: input.description.trim(),
      })
    },
    onSuccess: (_d, vars) => {
      toastSuccess(vars.id ? 'Papel atualizado' : 'Papel criado')
      invalidate()
      closeDialog()
    },
    onError: (e) => setFormError(errorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sudoService.deleteRole(id),
    onSuccess: () => {
      toastSuccess('Papel excluído')
      invalidate()
      setDeleting(null)
    },
    onError: (e) => {
      toastError(e, 'Não foi possível excluir')
      setDeleting(null)
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      sudoService.updateRole(id, { is_active }),
    onSuccess: () => invalidate(),
    onError: (e) => toastError(e, 'Não foi possível alterar o papel'),
  })

  const openCreate = () => {
    setForm(EMPTY)
    setFormError(null)
    setEditing(null)
    setCreating(true)
  }
  const openEdit = (role: RolesRow) => {
    setForm({ code: role.code, name: role.name, description: role.description })
    setFormError(null)
    setCreating(false)
    setEditing(role)
  }
  const closeDialog = () => {
    setCreating(false)
    setEditing(null)
    setFormError(null)
  }

  const dialogOpen = creating || editing !== null
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing && !CODE_RE.test(form.code.trim())) {
      setFormError('Código inválido: maiúsculas, números e _ (ex.: GERENTE_LOJA).')
      return
    }
    const nameLen = form.name.trim().length
    if (nameLen < 1 || nameLen > 120) {
      setFormError('O nome é obrigatório (até 120 caracteres).')
      return
    }
    setFormError(null)
    saveMutation.mutate({ ...form, id: editing?.id })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-bold">
            <ShieldCheck className="h-5 w-5 text-primary" /> Papéis
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Catálogo de papéis da plataforma. Definições de sistema não podem ser excluídas nem ter
            o código alterado.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Novo papel
        </Button>
      </div>

      <Alert variant="info" className="border-white/10 bg-white/5 text-white/80 [&>svg]:text-primary">
        <Info />
        <AlertDescription>
          Papéis customizados servem apenas como catálogo:{' '}
          <span className="font-mono text-xs">user_platform_roles</span> aceita somente USER e SUDO,
          atribuídos via SQL Editor.
        </AlertDescription>
      </Alert>

      {rolesQuery.isPending ? (
        <TableSkeleton rows={5} cols={5} />
      ) : rolesQuery.isError ? (
        <ErrorRetryState
          onRetry={() => void rolesQuery.refetch()}
          retrying={rolesQuery.isRefetching}
        />
      ) : rolesQuery.data.length === 0 ? (
        <EmptyState title="Nenhum papel cadastrado" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-white/60">Código</TableHead>
                <TableHead className="text-white/60">Nome</TableHead>
                <TableHead className="text-white/60">Descrição</TableHead>
                <TableHead className="text-white/60">Tipo</TableHead>
                <TableHead className="text-white/60">Ativo</TableHead>
                <TableHead className="text-right text-white/60">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolesQuery.data.map((role) => (
                <TableRow key={role.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="font-mono text-xs text-white/90">{role.code}</TableCell>
                  <TableCell className="font-medium text-white/90">{role.name}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm text-white/60">
                    {role.description || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[11px]',
                        role.is_system
                          ? 'border-primary/40 bg-primary/15 text-primary'
                          : 'border-white/20 bg-white/5 text-white/70',
                      )}
                    >
                      {role.is_system ? 'Sistema' : 'Customizado'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={role.is_active}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: role.id, is_active: checked })
                      }
                      aria-label={`${role.is_active ? 'Desativar' : 'Ativar'} papel ${role.code}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-white/60 hover:bg-white/10 hover:text-white"
                        onClick={() => openEdit(role)}
                        aria-label={`Editar papel ${role.code}`}
                      >
                        <Pencil />
                      </Button>
                      {!role.is_system && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-white/60 hover:bg-red-400/10 hover:text-red-300"
                          onClick={() => setDeleting(role)}
                          aria-label={`Excluir papel ${role.code}`}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Criar / editar */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? `Editar papel ${editing.code}` : 'Novo papel'}</DialogTitle>
              <DialogDescription>
                {editing?.is_system
                  ? 'Papel de sistema: código e flag de sistema são imutáveis.'
                  : 'Código em maiúsculas (ex.: GERENTE_LOJA); imutável após a criação.'}
              </DialogDescription>
            </DialogHeader>
            <FormField label="Código" htmlFor="role-code" required>
              <Input
                id="role-code"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))
                }
                disabled={!!editing}
                maxLength={50}
                placeholder="GERENTE_LOJA"
                className="font-mono"
              />
            </FormField>
            <FormField label="Nome" htmlFor="role-name" required>
              <Input
                id="role-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={120}
                placeholder="Gerente de loja"
              />
            </FormField>
            <FormField label="Descrição" htmlFor="role-description">
              <Textarea
                id="role-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </FormField>
            {formError && (
              <p className="text-xs font-medium text-destructive" role="alert">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {editing ? 'Salvar' : 'Criar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Excluir (somente não-sistema) */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir papel {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o papel do catálogo e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              disabled={deleteMutation.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
