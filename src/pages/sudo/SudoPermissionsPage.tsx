import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
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
import type { PermissionsRow } from '@/types/backend'

/**
 * SUDO — Permissões (guia 18): CRUD direto em permissions.
 * code ^[a-z][a-z0-9_.]{2,99}$; module 1..80; mesmas proteções de sistema
 * dos papéis (sem excluir sistema; code/imutabilidade garantidos no backend).
 */

const CODE_RE = /^[a-z][a-z0-9_.]{2,99}$/

interface PermForm {
  code: string
  module: string
  description: string
}

const EMPTY: PermForm = { code: '', module: '', description: '' }

export default function SudoPermissionsPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<PermissionsRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PermissionsRow | null>(null)
  const [form, setForm] = useState<PermForm>(EMPTY)
  const [formError, setFormError] = useState<string | null>(null)

  const permsQuery = useQuery({
    queryKey: ['sudo', 'permissions'],
    queryFn: () => sudoService.listPermissions(),
  })

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['sudo', 'permissions'] })

  const saveMutation = useMutation({
    mutationFn: async (input: PermForm & { id?: string }) => {
      if (input.id) {
        // Edição: code nunca é enviado (imutável); módulo/descrição podem mudar.
        return sudoService.updatePermission(input.id, {
          module: input.module.trim(),
          description: input.description.trim(),
        })
      }
      return sudoService.insertPermission({
        code: input.code.trim(),
        module: input.module.trim(),
        description: input.description.trim(),
      })
    },
    onSuccess: (_d, vars) => {
      toastSuccess(vars.id ? 'Permissão atualizada' : 'Permissão criada')
      invalidate()
      closeDialog()
    },
    onError: (e) => setFormError(errorMessage(e)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sudoService.deletePermission(id),
    onSuccess: () => {
      toastSuccess('Permissão excluída')
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
      sudoService.updatePermission(id, { is_active }),
    onSuccess: () => invalidate(),
    onError: (e) => toastError(e, 'Não foi possível alterar a permissão'),
  })

  const openCreate = () => {
    setForm(EMPTY)
    setFormError(null)
    setEditing(null)
    setCreating(true)
  }
  const openEdit = (perm: PermissionsRow) => {
    setForm({ code: perm.code, module: perm.module, description: perm.description })
    setFormError(null)
    setCreating(false)
    setEditing(perm)
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
      setFormError('Código inválido: minúsculas, números, ponto e _ (ex.: pedidos.exportar).')
      return
    }
    const moduleLen = form.module.trim().length
    if (moduleLen < 1 || moduleLen > 80) {
      setFormError('O módulo é obrigatório (até 80 caracteres).')
      return
    }
    setFormError(null)
    saveMutation.mutate({ ...form, id: editing?.id })
  }

  const grouped = useMemo(() => {
    const list = permsQuery.data ?? []
    const map = new Map<string, PermissionsRow[]>()
    for (const p of list) {
      const arr = map.get(p.module) ?? []
      arr.push(p)
      map.set(p.module, arr)
    }
    return [...map.entries()]
  }, [permsQuery.data])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-bold">
            <KeyRound className="h-5 w-5 text-primary" /> Permissões
          </h1>
          <p className="mt-1 text-sm text-white/60">
            Catálogo de permissões agrupadas por módulo.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus /> Nova permissão
        </Button>
      </div>

      <Alert variant="info" className="border-white/10 bg-white/5 text-white/80 [&>svg]:text-primary">
        <Info />
        <AlertDescription>
          Permissões novas não têm efeito até que exista código SQL que as consulte (funções
          <span className="font-mono text-xs"> has_permission</span> / checks nas RPCs).
        </AlertDescription>
      </Alert>

      {permsQuery.isPending ? (
        <TableSkeleton rows={8} cols={5} />
      ) : permsQuery.isError ? (
        <ErrorRetryState
          onRetry={() => void permsQuery.refetch()}
          retrying={permsQuery.isRefetching}
        />
      ) : grouped.length === 0 ? (
        <EmptyState title="Nenhuma permissão cadastrada" />
      ) : (
        <div className="space-y-4">
          {grouped.map(([module, perms]) => (
            <div
              key={module}
              className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
            >
              <div className="border-b border-white/10 px-4 py-2.5">
                <span className="font-mono text-xs font-semibold uppercase tracking-wide text-white/50">
                  {module}
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-white/60">Código</TableHead>
                    <TableHead className="text-white/60">Descrição</TableHead>
                    <TableHead className="text-white/60">Tipo</TableHead>
                    <TableHead className="text-white/60">Ativa</TableHead>
                    <TableHead className="text-right text-white/60">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perms.map((perm) => (
                    <TableRow key={perm.id} className="border-white/10 hover:bg-white/5">
                      <TableCell className="font-mono text-xs text-white/90">
                        {perm.code}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-sm text-white/60">
                        {perm.description || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[11px]',
                            perm.is_system
                              ? 'border-primary/40 bg-primary/15 text-primary'
                              : 'border-white/20 bg-white/5 text-white/70',
                          )}
                        >
                          {perm.is_system ? 'Sistema' : 'Customizada'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={perm.is_active}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: perm.id, is_active: checked })
                          }
                          aria-label={`${perm.is_active ? 'Desativar' : 'Ativar'} permissão ${perm.code}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-white/60 hover:bg-white/10 hover:text-white"
                            onClick={() => openEdit(perm)}
                            aria-label={`Editar permissão ${perm.code}`}
                          >
                            <Pencil />
                          </Button>
                          {!perm.is_system && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/60 hover:bg-red-400/10 hover:text-red-300"
                              onClick={() => setDeleting(perm)}
                              aria-label={`Excluir permissão ${perm.code}`}
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
          ))}
        </div>
      )}

      {/* Criar / editar */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                {editing ? `Editar permissão ${editing.code}` : 'Nova permissão'}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? 'O código da permissão é imutável.'
                  : 'Código em minúsculas (ex.: pedidos.exportar); imutável após a criação.'}
              </DialogDescription>
            </DialogHeader>
            <FormField label="Código" htmlFor="perm-code" required>
              <Input
                id="perm-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                disabled={!!editing}
                maxLength={100}
                placeholder="pedidos.exportar"
                className="font-mono"
              />
            </FormField>
            <FormField label="Módulo" htmlFor="perm-module" required>
              <Input
                id="perm-module"
                value={form.module}
                onChange={(e) => setForm((f) => ({ ...f, module: e.target.value }))}
                maxLength={80}
                placeholder="orders"
                className="font-mono"
              />
            </FormField>
            <FormField label="Descrição" htmlFor="perm-description">
              <Textarea
                id="perm-description"
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
            <AlertDialogTitle>Excluir permissão {deleting?.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              Papéis que a referenciam perderão a entrada correspondente na matriz.
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
