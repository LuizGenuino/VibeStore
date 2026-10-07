import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, UserX, UserCheck, Users } from 'lucide-react'
import { sudoService } from '@/services/sudo.service'
import { formatDateTime } from '@/lib/format'
import { toastError, toastSuccess } from '@/lib/feedback'
import { shortId } from '@/lib/format'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DataPagination } from '@/components/shared/pagination'
import { EmptyState, ErrorRetryState, TableSkeleton } from '@/components/shared/page-state'
import type { ProfilesRow, UserPlatformRolesRow } from '@/types/backend'

/**
 * SUDO — Usuários (guia 18): profiles + user_platform_roles (somente leitura —
 * NUNCA há botão "tornar SUDO"). E-mail não é exposto (Auth admin fica fora do
 * navegador): a lista é por nome/UUID. Ativar/desativar via RPC com confirmação.
 */
const PAGE_SIZE = 50

export default function SudoUsersPage() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState<{ user: ProfilesRow; activate: boolean } | null>(null)

  const usersQuery = useQuery({
    queryKey: ['sudo', 'users', page],
    queryFn: () => sudoService.listUsers(page, PAGE_SIZE),
  })

  const users = useMemo(() => usersQuery.data?.items ?? [], [usersQuery.data])
  const ids = useMemo(() => users.map((u) => u.id), [users])

  const rolesQuery = useQuery({
    queryKey: ['sudo', 'platform-roles', ids],
    queryFn: () => sudoService.listPlatformRoles(ids),
    enabled: ids.length > 0,
  })

  const roleByUser = useMemo(() => {
    const map = new Map<string, UserPlatformRolesRow['role_code']>()
    rolesQuery.data?.forEach((r) => map.set(r.user_id, r.role_code))
    return map
  }, [rolesQuery.data])

  // Busca client-side na página atual (nome ou UUID).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) => u.full_name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q),
    )
  }, [users, search])

  const toggleMutation = useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) =>
      sudoService.setUserActive(userId, active),
    onSuccess: (_data, vars) => {
      toastSuccess(vars.active ? 'Conta ativada' : 'Conta desativada')
      void queryClient.invalidateQueries({ queryKey: ['sudo', 'users'] })
    },
    // CANNOT_DISABLE_SELF e demais códigos chegam traduzidos pelo toastError.
    onError: (e) => toastError(e, 'Não foi possível alterar a conta'),
    onSettled: () => setConfirm(null),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <Users className="h-5 w-5 text-primary" /> Usuários da plataforma
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Listagem por nome/UUID (e-mail não é exposto ao navegador). A atribuição de papéis de
          plataforma é feita somente via SQL Editor — aqui ela é apenas exibida.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou UUID nesta página…"
          className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/40"
          aria-label="Buscar usuário"
        />
      </div>

      {usersQuery.isPending ? (
        <TableSkeleton rows={8} cols={5} />
      ) : usersQuery.isError ? (
        <ErrorRetryState
          onRetry={() => void usersQuery.refetch()}
          retrying={usersQuery.isRefetching}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search ? 'Nenhum usuário corresponde à busca' : 'Nenhum usuário cadastrado'}
          description={search ? 'A busca vale apenas para a página atual.' : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-white/60">Nome</TableHead>
                <TableHead className="text-white/60">UUID</TableHead>
                <TableHead className="text-white/60">Papel</TableHead>
                <TableHead className="text-white/60">Status</TableHead>
                <TableHead className="text-white/60">Cadastro</TableHead>
                <TableHead className="text-right text-white/60">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((user) => {
                const role = roleByUser.get(user.id)
                return (
                  <TableRow key={user.id} className="border-white/10 hover:bg-white/5">
                    <TableCell className="font-medium text-white/90">
                      {user.full_name || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-white/60" title={user.id}>
                      {shortId(user.id)}
                    </TableCell>
                    <TableCell>
                      {role ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-mono text-[11px]',
                            role === 'SUDO'
                              ? 'border-primary/40 bg-primary/15 text-primary'
                              : 'border-white/20 bg-white/5 text-white/70',
                          )}
                        >
                          {role}
                        </Badge>
                      ) : (
                        <span className="text-xs text-white/40">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          user.is_active
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                            : 'border-red-400/30 bg-red-400/10 text-red-300',
                        )}
                      >
                        {user.is_active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-white/60">
                      {formatDateTime(user.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-white/15 bg-transparent text-white/80 hover:bg-white/10 hover:text-white"
                        onClick={() => setConfirm({ user, activate: !user.is_active })}
                      >
                        {user.is_active ? <UserX /> : <UserCheck />}
                        {user.is_active ? 'Desativar' : 'Ativar'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {usersQuery.data && !search && (
        <DataPagination
          page={page}
          total={usersQuery.data.total}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      )}

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.activate ? 'Ativar conta' : 'Desativar conta'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.activate
                ? `A conta de ${confirm.user.full_name || shortId(confirm.user.id)} voltará a acessar a plataforma.`
                : `A conta de ${confirm?.user.full_name || shortId(confirm?.user.id)} perderá o acesso imediatamente. Você não pode desativar a própria conta.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm &&
                toggleMutation.mutate({ userId: confirm.user.id, active: confirm.activate })
              }
              disabled={toggleMutation.isPending}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
