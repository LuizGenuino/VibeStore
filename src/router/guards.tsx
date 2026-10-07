import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore } from '@/stores/access'
import { safeRedirect } from '@/lib/safeRedirect'
import type { PermissionCode } from '@/types/backend'
import { RefreshCw } from 'lucide-react'

/**
 * Guards (guia 3.2) adaptados para React Router.
 * Ordem: sessão → conta ativa → SUDO → loja → permissão de loja.
 */

function FullScreenLoading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <RefreshCw className="h-5 w-5 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  )
}

/** Garante que a sessão inicial foi resolvida antes de decidir qualquer rota. */
function useAuthReady() {
  const ready = useAuthStore((s) => s.ready)
  const session = useAuthStore((s) => s.session)
  const [done, setDone] = useState(false)
  useEffect(() => {
    let alive = true
    ready?.then(() => alive && setDone(true))
    return () => {
      alive = false
    }
  }, [ready])
  return { done, session }
}

/** Carrega acesso (get_my_access + loja + get_store_access) uma vez por sessão. */
function useAccessReady(enabled: boolean) {
  const loading = useAccessStore((s) => s.loading)
  const my = useAccessStore((s) => s.my)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    useAccessStore
      .getState()
      .ensureLoaded()
      .catch(() => undefined)
      .finally(() => alive && setDone(true))
    return () => {
      alive = false
    }
  }, [enabled, loading, my])
  return done || !!my
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { done, session } = useAuthReady()
  if (!done) return <FullScreenLoading />
  if (session) return <Navigate to="/app" replace />
  return <>{children}</>
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { done, session } = useAuthReady()
  const location = useLocation()
  if (!done) return <FullScreenLoading />
  if (!session)
    return (
      <Navigate
        to={`/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  return <>{children}</>
}

export function RequireStore({
  perm,
  children,
}: {
  perm?: PermissionCode
  children: ReactNode
}) {
  const { done, session } = useAuthReady()
  const location = useLocation()
  const accessReady = useAccessReady(done && !!session)
  const my = useAccessStore((s) => s.my)
  const store = useAccessStore((s) => s.store)
  const storeAccess = useAccessStore((s) => s.storeAccess)
  const signOut = useAuthStore((s) => s.signOut)

  if (!done || !accessReady) return <FullScreenLoading />
  if (!session)
    return (
      <Navigate
        to={`/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  if (my && !my.account_active) {
    void signOut()
    return <Navigate to="/auth/login?reason=inactive" replace />
  }
  if (!store) {
    const canCreate = !!my?.permissions.includes('store.create')
    return <Navigate to={canCreate ? '/app/onboarding/plan' : '/app/profile'} replace />
  }
  if (perm && !storeAccess?.permissions.includes(perm))
    return <Navigate to={`/app?denied=${encodeURIComponent(perm)}`} replace />
  return <>{children}</>
}

/** Onboarding: somente usuário autenticado SEM loja. */
export function NoStoreOnly({ children }: { children: ReactNode }) {
  const { done, session } = useAuthReady()
  const accessReady = useAccessReady(done && !!session)
  const store = useAccessStore((s) => s.store)
  if (!done || !accessReady) return <FullScreenLoading />
  if (!session) return <Navigate to="/auth/login" replace />
  if (store) return <Navigate to="/app" replace />
  return <>{children}</>
}

export function SudoOnly({ children }: { children: ReactNode }) {
  const { done, session } = useAuthReady()
  const accessReady = useAccessReady(done && !!session)
  const my = useAccessStore((s) => s.my)
  if (!done || !accessReady) return <FullScreenLoading />
  if (!session) return <Navigate to="/auth/login" replace />
  if (!my?.can_manage_security) return <Navigate to="/app" replace />
  return <>{children}</>
}

/** Pós-login: resolve o redirect interno seguro (anti open-redirect). */
export function useSafeRedirectTarget(fallback = '/app') {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  return safeRedirect(params.get('redirect'), fallback)
}
