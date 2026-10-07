import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  ExternalLink,
  Globe,
  ListChecks,
  Package,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react'
import { dashboardService } from '@/services/dashboard.service'
import { reportsService } from '@/services/reports.service'
import { useActiveStore, useHasStorePerm, useStoreId } from '@/stores/access'
import { brl } from '@/lib/money'
import { todayIso } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/shared/page-header'
import { KpiCard } from '@/components/shared/kpi-card'
import { CopyButton } from '@/components/shared/copy-button'
import { ErrorRetryState } from '@/components/shared/page-state'
import { cn } from '@/lib/utils'

interface LowStockRow {
  product_id: string | null
  code: string | null
  name: string | null
  available_quantity: number | null
}

/** /app (guia 17): blocos condicionados à permissão efetiva na loja. */
export default function DashboardPage() {
  const store = useActiveStore()
  const storeId = useStoreId()

  const canReadStore = useHasStorePerm('store.read')
  const canReadOrders = useHasStorePerm('orders.read')
  const canReadInventory = useHasStorePerm('inventory.read')
  const canReadReports = useHasStorePerm('reports.read')

  // Mês atual (fuso America/Sao_Paulo), primeiro e último dia.
  const month = useMemo(() => {
    const today = todayIso()
    const [y, m] = today.split('-').map(Number)
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return {
      from: `${today.slice(0, 7)}-01`,
      to: `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`,
    }
  }, [])

  // (a) Checklist de ativação — store.read
  const activation = useQuery({
    queryKey: ['dashboard', storeId, 'activation'],
    enabled: !!storeId && canReadStore,
    queryFn: async () => {
      const [categories, activeProducts, withStock] = await Promise.all([
        dashboardService.countCategories(storeId!),
        dashboardService.countProducts(storeId!, 'ACTIVE'),
        dashboardService.countProductsWithStock(storeId!),
      ])
      return { categories, activeProducts, withStock }
    },
  })

  // (b) KPIs de pedidos — orders.read
  const orderKpis = useQuery({
    queryKey: ['dashboard', storeId, 'order-kpis'],
    enabled: !!storeId && canReadOrders,
    queryFn: async () => {
      const [pending, paid, expired] = await Promise.all([
        dashboardService.countPendingOrders(storeId!),
        dashboardService.countPaidOrders(storeId!),
        dashboardService.countExpiredReservations(storeId!),
      ])
      return { pending, paid, expired }
    },
  })

  // (c) Estoque zerado/baixo — inventory.read
  const lowStock = useQuery({
    queryKey: ['dashboard', storeId, 'low-stock'],
    enabled: !!storeId && canReadInventory,
    queryFn: () => dashboardService.listLowStock(storeId!, 3),
  })
  const lowStockRows = (lowStock.data ?? []) as LowStockRow[]

  // (d) Resumo do mês — reports.read
  const summary = useQuery({
    queryKey: ['dashboard', storeId, 'month-summary', month.from],
    enabled: !!storeId && canReadReports,
    queryFn: () => reportsService.getSummary(storeId!, month.from, month.to),
  })

  if (!store) return null

  const publicUrl = `${window.location.origin}/s/${store.slug}`

  const checklist = activation.data
    ? [
        {
          done: !!store.logo_path,
          label: 'Adicione o logo da loja',
          to: '/app/store/settings',
          cta: 'Adicionar',
        },
        {
          done: activation.data.categories > 0,
          label: 'Crie a primeira categoria',
          to: '/app/catalog/categories',
          cta: 'Criar',
        },
        {
          done: activation.data.activeProducts > 0,
          label: 'Cadastre um produto ativo',
          to: '/app/catalog/products/new',
          cta: 'Cadastrar',
        },
        {
          done: activation.data.withStock > 0,
          label: 'Dê entrada no estoque',
          to: '/app/inventory',
          cta: 'Registrar',
        },
        {
          done: store.is_published,
          label: 'Publique a loja',
          to: '/app/store/settings',
          cta: 'Publicar',
        },
      ]
    : []
  const checklistDone = checklist.filter((i) => i.done).length

  return (
    <div>
      <PageHeader
        title="Visão geral"
        description={`Acompanhe a saúde da loja ${store.name}.`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* (a) Checklist de ativação */}
        {canReadStore && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Ativação da loja</CardTitle>
                </div>
                {activation.data && (
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {checklistDone}/{checklist.length} concluídos
                  </span>
                )}
              </div>
              <CardDescription>Complete os passos para começar a vender.</CardDescription>
            </CardHeader>
            <CardContent>
              {activation.isLoading ? (
                <div className="space-y-2" aria-busy="true" aria-label="Carregando">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : activation.isError ? (
                <ErrorRetryState
                  onRetry={() => activation.refetch()}
                  retrying={activation.isRefetching}
                />
              ) : checklistDone === checklist.length ? (
                <p className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Tudo pronto — sua loja está completa e no ar.
                </p>
              ) : (
                <ul className="space-y-1">
                  {checklist.map((item) => (
                    <li
                      key={item.label}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5"
                    >
                      <span className="flex items-center gap-2 text-sm">
                        {item.done ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className={cn(item.done && 'text-muted-foreground line-through')}>
                          {item.label}
                        </span>
                      </span>
                      {!item.done && (
                        <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
                          <Link to={item.to}>{item.cta}</Link>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* (b) KPIs de pedidos */}
        {canReadOrders && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">Pedidos</h2>
            {orderKpis.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : orderKpis.isError ? (
              <ErrorRetryState onRetry={() => orderKpis.refetch()} retrying={orderKpis.isRefetching} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                <KpiCard
                  label="Aguardando ação"
                  value={String(orderKpis.data?.pending ?? 0)}
                  hint="pedidos pendentes"
                  icon={ShoppingCart}
                  tone={orderKpis.data?.pending ? 'warning' : 'default'}
                />
                <KpiCard
                  label="A enviar"
                  value={String(orderKpis.data?.paid ?? 0)}
                  hint="pedidos pagos"
                  icon={Truck}
                />
                <KpiCard
                  label="Reservas expiradas"
                  value={String(orderKpis.data?.expired ?? 0)}
                  hint="pendentes vencidos"
                  icon={Clock}
                  tone={orderKpis.data?.expired ? 'destructive' : 'default'}
                />
              </div>
            )}
            <Button asChild variant="outline" size="sm">
              <Link to="/app/orders">Ver todos os pedidos</Link>
            </Button>
          </div>
        )}

        {/* (c) Estoque zerado/baixo */}
        {canReadInventory && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">Estoque baixo</CardTitle>
                </div>
                <Button asChild variant="link" size="sm" className="h-auto p-0">
                  <Link to="/app/inventory">Ir para o estoque</Link>
                </Button>
              </div>
              <CardDescription>Produtos com 3 ou menos unidades disponíveis.</CardDescription>
            </CardHeader>
            <CardContent>
              {lowStock.isLoading ? (
                <div className="space-y-2" aria-busy="true" aria-label="Carregando">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-9 w-full" />
                  ))}
                </div>
              ) : lowStock.isError ? (
                <ErrorRetryState onRetry={() => lowStock.refetch()} retrying={lowStock.isRefetching} />
              ) : lowStockRows.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Nenhum produto com estoque baixo.
                </p>
              ) : (
                <ul className="divide-y">
                  {lowStockRows.slice(0, 5).map((row) => {
                    const available = row.available_quantity ?? 0
                    return (
                      <li
                        key={row.product_id ?? row.code ?? row.name}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{row.name ?? '—'}</p>
                          <p className="font-mono text-xs text-muted-foreground">{row.code ?? '—'}</p>
                        </div>
                        <span
                          className={cn(
                            'flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums',
                            available <= 0
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-warning/15 text-warning',
                          )}
                        >
                          {available <= 0 && <AlertTriangle className="h-3 w-3" />}
                          {available} un.
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* (d) Resumo do mês */}
        {canReadReports && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">Resumo do mês</h2>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link to="/app/reports">Ver relatórios</Link>
              </Button>
            </div>
            {summary.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full" />
                ))}
              </div>
            ) : summary.isError ? (
              <ErrorRetryState onRetry={() => summary.refetch()} retrying={summary.isRefetching} />
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  <KpiCard
                    label="Receita líquida"
                    value={brl(summary.data?.net_revenue)}
                    hint="produtos + frete, líquidos"
                    icon={TrendingUp}
                  />
                  <KpiCard
                    label="Resultado operacional"
                    value={brl(summary.data?.estimated_operating_result)}
                    hint="estimativa do mês"
                    icon={Wallet}
                    tone={
                      (summary.data?.estimated_operating_result ?? 0) < 0 ? 'destructive' : 'success'
                    }
                  />
                  <KpiCard
                    label="Fluxo de caixa"
                    value={brl(summary.data?.net_cash_flow)}
                    hint="recebido − pago no mês"
                    icon={Wallet}
                    tone={(summary.data?.net_cash_flow ?? 0) < 0 ? 'destructive' : 'default'}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Valores gerenciais estimados em base de caixa (manual), não substituem a
                  contabilidade.
                </p>
              </>
            )}
          </div>
        )}

        {/* (e) Link público da vitrine */}
        {canReadStore && store.is_published && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">Sua vitrine está no ar</CardTitle>
              </div>
              <CardDescription>Compartilhe o link público com seus clientes.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{publicUrl}</span>
                <CopyButton text={publicUrl} toastTitle="Link copiado" />
                <Button asChild variant="outline" size="sm">
                  <a href={publicUrl} target="_blank" rel="noreferrer">
                    <ExternalLink /> Abrir
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
