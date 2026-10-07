import { rpc } from '@/lib/rpc'
import { DEFAULT_TZ } from '@/lib/format'
import type {
  ErpDaily,
  ErpExpenseBreakdown,
  ErpPeriodArgs,
  ErpProductPerformance,
  ErpProductPerformanceArgs,
  ErpSummary,
  IsoDate,
  Uuid,
} from '@/types'

/** Relatórios ERP (guia 16) — gerencial, base de caixa manual; sempre estimativa. */
export function assertPeriod(from: IsoDate, to: IsoDate) {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000
  if (!(days >= 0 && days <= 365)) throw new Error('INVALID_REPORT_PERIOD_OR_TIMEZONE')
}

export const reportsService = {
  getSummary: (storeId: Uuid, from: IsoDate, to: IsoDate, tz: string = DEFAULT_TZ) =>
    rpc<ErpPeriodArgs, ErpSummary>('get_erp_summary', {
      p_store_id: storeId,
      p_from: from,
      p_to: to,
      p_timezone: tz,
    }),

  getDaily: (storeId: Uuid, from: IsoDate, to: IsoDate, tz: string = DEFAULT_TZ) =>
    rpc<ErpPeriodArgs, ErpDaily>('get_erp_daily', {
      p_store_id: storeId,
      p_from: from,
      p_to: to,
      p_timezone: tz,
    }),

  getProductPerformance: (storeId: Uuid, from: IsoDate, to: IsoDate, limit = 20, tz: string = DEFAULT_TZ) =>
    rpc<ErpProductPerformanceArgs, ErpProductPerformance>('get_erp_product_performance', {
      p_store_id: storeId,
      p_from: from,
      p_to: to,
      p_timezone: tz,
      p_limit: limit,
    }),

  getExpenseBreakdown: (storeId: Uuid, from: IsoDate, to: IsoDate, tz: string = DEFAULT_TZ) =>
    rpc<ErpPeriodArgs, ErpExpenseBreakdown>('get_erp_expense_breakdown', {
      p_store_id: storeId,
      p_from: from,
      p_to: to,
      p_timezone: tz,
    }),

  async loadReports(storeId: Uuid, from: IsoDate, to: IsoDate, tz: string = DEFAULT_TZ) {
    assertPeriod(from, to)
    const [summary, daily, products, expenses] = await Promise.all([
      reportsService.getSummary(storeId, from, to, tz),
      reportsService.getDaily(storeId, from, to, tz),
      reportsService.getProductPerformance(storeId, from, to, 20, tz),
      reportsService.getExpenseBreakdown(storeId, from, to, tz),
    ])
    return { summary, daily, products, expenses }
  },
}
