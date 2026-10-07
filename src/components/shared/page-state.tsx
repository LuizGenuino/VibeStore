import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Inbox,
  Lock,
  RefreshCw,
  SearchX,
  FileQuestion,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Estados de tela padrão (guia 2.7):
 * loading (skeleton) · refreshing (barra no topo) · empty · empty-filtered ·
 * forbidden · not-found · error-retryable · error-validation · stale · rate-limited
 */

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Carregando">
      <div className="flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-11 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function RefreshingBar({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <div className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/15">
      <div className="h-full w-1/3 animate-[refresh-bar_1.1s_ease-in-out_infinite] bg-primary" />
      <style>{`@keyframes refresh-bar { 0% { margin-left: -33% } 100% { margin-left: 100% } }`}</style>
    </div>
  )
}

interface StateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

function StateShell({ icon, title, description, action, className }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card/50 px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="font-display text-base font-semibold">{title}</p>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return <StateShell icon={<Inbox className="h-5 w-5" />} title={title} description={description} action={action} />
}

export function EmptyFilteredState({ onClear }: { onClear: () => void }) {
  return (
    <StateShell
      icon={<SearchX className="h-5 w-5" />}
      title="Nenhum resultado para os filtros"
      description="Ajuste ou limpe os filtros para ver mais resultados."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          Limpar filtros
        </Button>
      }
    />
  )
}

export function ForbiddenState() {
  return (
    <StateShell
      icon={<Lock className="h-5 w-5" />}
      title="Você não tem acesso a este recurso"
      description="Se precisar deste acesso, fale com o administrador da conta."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/app">Voltar ao início</Link>
        </Button>
      }
    />
  )
}

export function NotFoundState({
  title = 'Página não encontrada',
  backTo,
  backLabel = 'Voltar',
}: {
  title?: string
  backTo?: string
  backLabel?: string
}) {
  return (
    <StateShell
      icon={<FileQuestion className="h-5 w-5" />}
      title={title}
      description="O registro pode ter sido removido ou o link está incorreto."
      action={
        backTo ? (
          <Button asChild variant="outline" size="sm">
            <Link to={backTo}>{backLabel}</Link>
          </Button>
        ) : undefined
      }
    />
  )
}

export function ErrorRetryState({
  description,
  onRetry,
  retrying,
}: {
  description?: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <StateShell
      icon={<AlertTriangle className="h-5 w-5" />}
      title="Não foi possível carregar"
      description={description ?? 'Falha de conexão ou serviço indisponível.'}
      action={
        <Button size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn(retrying && 'animate-spin')} />
          Tentar novamente
        </Button>
      }
    />
  )
}
