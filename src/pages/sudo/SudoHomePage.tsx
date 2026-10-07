import { useQuery } from '@tanstack/react-query'
import { History, ShieldCheck } from 'lucide-react'
import { sudoService } from '@/services/sudo.service'
import { useMyAccess } from '@/stores/access'
import { formatDateTime } from '@/lib/format'
import { errorMessage } from '@/lib/feedback'
import { shortId } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorRetryState, TableSkeleton } from '@/components/shared/page-state'
import type { Json, SecurityAuditLogsRow } from '@/types/backend'

/**
 * SUDO — Auditoria (guia 18): get_my_access vem do useAccessStore;
 * aqui listamos os últimos 100 registros de security_audit_logs.
 */

const OP_TONE: Record<SecurityAuditLogsRow['operation'], string> = {
  INSERT: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  UPDATE: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  DELETE: 'border-red-400/30 bg-red-400/10 text-red-300',
}

function JsonBlock({ label, value }: { label: string; value: Json | null }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">
        {label}
      </p>
      <pre className="max-h-64 overflow-auto rounded-md bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-white/80">
        {value === null ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export default function SudoHomePage() {
  const my = useMyAccess()

  const logsQuery = useQuery({
    queryKey: ['sudo', 'audit-logs'],
    queryFn: () => sudoService.listAuditLogs(1, 100),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <History className="h-5 w-5 text-primary" /> Auditoria de segurança
        </h1>
        <p className="mt-1 text-sm text-white/60">
          Últimos 100 eventos em tabelas protegidas. Toda escrita do painel é registrada aqui.
        </p>
      </div>

      {my && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="text-white/70">Sessão:</span>
          <span className="font-mono text-xs text-white/90">{shortId(my.user_id)}</span>
          {my.roles.map((role: string) => (
            <Badge key={role} className="border-primary/40 bg-primary/15 text-primary">
              {role}
            </Badge>
          ))}
          <span className="text-xs text-white/50">
            {my.permissions.length} permissões globais ativas
          </span>
        </div>
      )}

      {logsQuery.isPending ? (
        <TableSkeleton rows={8} cols={5} />
      ) : logsQuery.isError ? (
        <ErrorRetryState
          description={errorMessage(logsQuery.error)}
          onRetry={() => void logsQuery.refetch()}
          retrying={logsQuery.isRefetching}
        />
      ) : logsQuery.data.length === 0 ? (
        <EmptyState
          title="Nenhum evento de auditoria"
          description="As ações administrativas aparecerão aqui assim que ocorrerem."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-white/60">Data</TableHead>
                <TableHead className="text-white/60">Tabela</TableHead>
                <TableHead className="text-white/60">Operação</TableHead>
                <TableHead className="text-white/60">Autor</TableHead>
                <TableHead className="text-white/60">Alteração</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logsQuery.data.map((log) => (
                <TableRow key={log.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="whitespace-nowrap text-white/80">
                    {formatDateTime(log.created_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white/80">
                    {log.table_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('font-mono text-[11px]', OP_TONE[log.operation])}>
                      {log.operation}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-white/60">
                    {shortId(log.actor_id)}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <details className="group text-xs">
                      <summary className="cursor-pointer select-none text-primary hover:underline">
                        ver diff
                      </summary>
                      <div className="mt-2 grid gap-2">
                        {log.operation !== 'INSERT' && (
                          <JsonBlock label="Antes" value={log.row_before} />
                        )}
                        {log.operation !== 'DELETE' && (
                          <JsonBlock label="Depois" value={log.row_after} />
                        )}
                      </div>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
