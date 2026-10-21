import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Info } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { reportsService } from '@/services/reports.service'
import { useHasStorePerm, useStoreId } from '@/stores/access'
import { BackendError } from '@/lib/rpc'
import { EXPENSE_CLASSIFICATION_LABELS } from '@/lib/constants'
import { brl } from '@/lib/money'
import { addDays, todayIso } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/page-header'
import {
  EmptyState,
  ErrorRetryState,
  ForbiddenState,
} from '@/components/shared/page-state'
import { KpiCard } from '@/components/shared/kpi-card'
import { CodeChip } from '@/components/shared/order-status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Preset {
  label: string
  range: () => [string, string]
}

/** Presets de período (guia 16): hoje, 7 dias, mês atual, mês anterior, ano até hoje. */
const PRESETS: Preset[] = [
  { label: 'Hoje', range: () => [todayIso(), todayIso()] },
  { label: '7 dias', range: () => [addDays(todayIso(), -6), todayIso()] },
  {
    label: 'Mês atual',
    range: () => [`${todayIso().slice(0, 8)}01`, todayIso()],
  },
  {
    label: 'Mês anterior',
    range: () => {
      const [y, m] = todayIso().split('-').map(Number)
      const prev = new Date(Date.UTC(y, m - 2, 1))
      const start = prev.toISOString().slice(0, 10)
      const end = addDays(`${todayIso().slice(0, 8)}01`, -1)
      return [start, end]
    },
  },
  {
    label: 'Ano até hoje',
    range: () => [`${todayIso().slice(0, 4)}-01-01`, todayIso()],
  },
]

const periodDays = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 86_400_000

/** Máx. 366 dias (to − from ≤ 365) — bloqueado ANTES da chamada (INVALID_REPORT_PERIOD_OR_TIMEZONE). */
const periodValid = (from: string, to: string) => {
  const d = periodDays(from, to)
  return !!from && !!to && d >= 0 && d <= 365
}

const fmtPercent = (v: number | null): string =>
  v == null ? '—' : `${Number(v).toFixed(1).replace('.', ',')}%`

const fmtInt = (v: number): string => Number(v).toLocaleString('pt-BR')

const dayTick = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

function ReportsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  )
}

/** /app/reports (guia 16) — ERP gerencial, base de caixa manual, sempre estimativa. */
export default function ReportsPage() {
  const storeId = useStoreId()
  const canRead = useHasStorePerm('reports.read')

  const [from, setFrom] = useState(() => `${todayIso().slice(0, 8)}01`)
  const [to, setTo] = useState(todayIso())

  const valid = periodValid(from, to)

  const q = useQuery({
    queryKey: ['reports', storeId, { from, to }],
    queryFn: () => reportsService.loadReports(storeId!, from, to),
    enabled: !!storeId && canRead && valid,
  })

  const chartData = useMemo(
    () =>
      (q.data?.daily.days ?? []).map((d) => ({
        ...d,
        day: dayTick(d.date),
      })),
    [q.data],
  )

  if (!canRead) return <ForbiddenState />

  if (q.isError) {
    const e = q.error
    if (e instanceof BackendError && (e.code === 'REPORT_FORBIDDEN' || e.isForbidden)) {
      return <ForbiddenState />
    }
    return <ErrorRetryState onRetry={() => q.refetch()} retrying={q.isFetching} />
  }

  const s = q.data?.summary
  const losses = s ? Number(s.returned_damage_loss) + Number(s.inventory_adjustment_cost) : 0
  const allZero =
    s != null &&
    [
      s.net_revenue,
      s.net_cogs,
      s.net_operating_expenses,
      s.cash_received,
      s.cash_paid_net,
      s.net_inventory_purchase_cash,
      s.receipt_count,
      s.refund_count,
      s.units_sold,
    ].every((v) => Number(v) === 0)

  const maxExpense = Math.max(0, ...(q.data?.expenses.categories ?? []).map((c) => Number(c.net_amount)))

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Resultado operacional estimado — gerencial, base de caixa manual."
      />

      {/* Seletor de período */}
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div className="flex items-center gap-1">
          <div>
            <Label htmlFor="rep-from" className="mb-1 block text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id="rep-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-36"
            />
          </div>
          <div>
            <Label htmlFor="rep-to" className="mb-1 block text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id="rep-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-36"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              onClick={() => {
                const [f, t] = p.range()
                setFrom(f)
                setTo(t)
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      {!valid && (
        <p className="mb-4 text-sm font-medium text-destructive" role="alert">
          Selecione um período válido de até 366 dias.
        </p>
      )}

      {!valid ? null : q.isLoading || !s ? (
        <ReportsSkeleton />
      ) : allZero ? (
        <EmptyState
          title="Sem movimentação no período"
          description="Não há recebimentos, despesas ou vendas registrados neste intervalo."
        />
      ) : (
        <div className="mt-4 space-y-4">
          {/* Base e avisos — sempre visíveis */}
          <Alert>
            <Info />
            <AlertTitle>Resultado operacional estimado</AlertTitle>
            <AlertDescription>
              Gerencial, base de caixa manual — não é lucro fiscal nem saldo bancário. Receitas e
              custos entram na data do recebimento manual.
            </AlertDescription>
          </Alert>
          {s.needs_stock_review && (
            <Alert className="border-warning/40 bg-warning/10">
              <AlertTriangle />
              <AlertTitle>Saídas de estoque sem classificação</AlertTitle>
              <AlertDescription>
                {brl(s.unclassified_stock_outbound_value)} em saídas de estoque sem classificação (
                {fmtInt(s.unclassified_stock_event_count)}{' '}
                {s.unclassified_stock_event_count === 1 ? 'evento' : 'eventos'}). Elas não entram no
                resultado.{' '}
                <Link to="/app/inventory/movements?type=EXIT" className="font-medium underline">
                  Ver movimentações
                </Link>
              </AlertDescription>
            </Alert>
          )}

          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Receita líquida" value={brl(s.net_revenue)} hint="Produtos + frete, líquido de devoluções" />
            <KpiCard label="CMV" value={brl(s.net_cogs)} hint="Custo alocado na baixa do estoque" />
            <KpiCard label="Margem bruta" value={brl(s.gross_margin)} />
            <KpiCard label="Perdas" value={brl(losses)} hint="Itens danificados + ajustes de contagem" tone={losses > 0 ? 'destructive' : 'default'} />
            <KpiCard label="Despesas operacionais" value={brl(s.net_operating_expenses)} />
            <KpiCard
              label="Resultado operacional estimado"
              value={brl(s.estimated_operating_result)}
              tone={Number(s.estimated_operating_result) >= 0 ? 'success' : 'destructive'}
              hint={`Margem: ${fmtPercent(s.operating_margin_percent)}`}
            />
            <KpiCard label="Margem operacional" value={fmtPercent(s.operating_margin_percent)} />
            <KpiCard label="Compras de estoque" value={brl(s.net_inventory_purchase_cash)} hint="Somente caixa — custo entra via CMV" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Caixa recebido" value={brl(s.cash_received)} />
            <KpiCard label="Caixa pago" value={brl(s.cash_paid_net)} />
            <KpiCard
              label="Caixa líquido"
              value={brl(s.net_cash_flow)}
              tone={Number(s.net_cash_flow) >= 0 ? 'success' : 'destructive'}
            />
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Volume
                </p>
                <ul className="mt-1.5 space-y-1 text-sm tabular-nums">
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Recebimentos</span>
                    <strong>{fmtInt(s.receipt_count)}</strong>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Reembolsos</span>
                    <strong>{fmtInt(s.refund_count)}</strong>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Unidades vendidas</span>
                    <strong>{fmtInt(s.units_sold)}</strong>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Unidades repostas</span>
                    <strong>{fmtInt(s.units_restocked)}</strong>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-muted-foreground">Ticket médio</span>
                    <strong>{s.average_receipt == null ? '—' : brl(s.average_receipt)}</strong>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Série diária */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Evolução diária</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={(v: number) =>
                        `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
                      }
                    />
                    <Tooltip
                      formatter={(value) => brl(Number(value))}
                      labelFormatter={(label) => `Dia ${label}`}
                    />
                    <Legend />
                    <Bar
                      dataKey="net_cash_flow"
                      name="Caixa líquido"
                      fill="hsl(var(--secondary))"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="net_revenue"
                      name="Receita líquida"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="estimated_operating_result"
                      name="Resultado operacional estimado"
                      stroke="hsl(var(--success))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Top produtos */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Top produtos</CardTitle>
              </CardHeader>
              <CardContent>
                {q.data!.products.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma venda no período.</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead className="text-right">Unid.</TableHead>
                            <TableHead className="text-right">Receita</TableHead>
                            <TableHead className="text-right">CMV</TableHead>
                            <TableHead className="text-right">Perdas</TableHead>
                            <TableHead className="text-right">Contribuição</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {q.data!.products.products.map((p) => (
                            <TableRow key={p.product_id}>
                              <TableCell>
                                <p className="text-sm font-medium">{p.name_snapshot}</p>
                                <CodeChip code={p.code} className="mt-0.5" />
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtInt(p.net_units)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {brl(p.net_goods_revenue)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {brl(p.net_cogs)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'text-right tabular-nums',
                                  Number(p.damage_loss) > 0 && 'text-destructive',
                                )}
                              >
                                {brl(p.damage_loss)}
                              </TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {brl(p.contribution_before_shared_expenses)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {q.data!.products.note && (
                      <p className="mt-3 text-xs text-muted-foreground">{q.data!.products.note}</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              {/* Despesas por categoria */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Despesas por categoria</CardTitle>
                </CardHeader>
                <CardContent>
                  {q.data!.expenses.categories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma despesa no período.</p>
                  ) : (
                    <ul className="space-y-3">
                      {q.data!.expenses.categories.map((c) => (
                        <li key={c.category_id}>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate">
                              {c.name_snapshot}
                              <span className="ml-1.5 text-xs text-muted-foreground">
                                {EXPENSE_CLASSIFICATION_LABELS[c.classification]}
                              </span>
                            </span>
                            <strong className="shrink-0 tabular-nums">{brl(c.net_amount)}</strong>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${maxExpense > 0 ? Math.max(2, (Number(c.net_amount) / maxExpense) * 100) : 0}%`,
                              }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {/* Estoque agora (snapshot atual, NÃO fim do período) */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Estoque agora</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5 text-sm tabular-nums">
                    <li className="flex justify-between">
                      <span className="text-muted-foreground">Unidades</span>
                      <strong className="font-mono">
                        {fmtInt(s.inventory_snapshot_current.quantity)}
                      </strong>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-muted-foreground">Valor em estoque</span>
                      <strong>{brl(s.inventory_snapshot_current.stock_value)}</strong>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-muted-foreground">Reservadas</span>
                      <strong className="font-mono">
                        {fmtInt(s.inventory_snapshot_current.reserved_quantity)}
                      </strong>
                    </li>
                  </ul>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Posição de agora — não é o estoque no fim do período.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
