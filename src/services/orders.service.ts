import { rpc, toBackendError, BackendError } from '@/lib/rpc'
import { supabase } from '@/lib/supabase'
import { clearPending, stablePending } from '@/lib/pending'
import { startOfDayIso, addDays } from '@/lib/format'
import type {
  CancelOrderArgs,
  ConfirmOrderPaymentArgs,
  DeliverOrderArgs,
  InventoryReservationsRow,
  ManualMethod,
  OrderItemsRow,
  OrderOperationResult,
  OrderPaymentsRow,
  OrderReturnItemsRow,
  OrdersRow,
  OrderStatus,
  OrderStatusHistoryRow,
  ReturnOrderArgs,
  ReturnOrderItem,
  ShipOrderArgs,
  UpdateOrderTermsArgs,
  Uuid,
} from '@/types'

export interface OrderListFilters {
  status?: OrderStatus[]
  code?: string
  customerId?: Uuid | null
  from?: string
  to?: string
  page: number
  pageSize?: number
}

export interface OrderDetail {
  order: OrdersRow | null
  items: OrderItemsRow[]
  history: OrderStatusHistoryRow[]
  payments: OrderPaymentsRow[]
  reservations: InventoryReservationsRow[]
  returns: OrderReturnItemsRow[]
}

type Op = 'terms' | 'pay' | 'ship' | 'deliver' | 'cancel' | 'return'
const opKey = (orderId: Uuid, op: Op) => `order:${orderId}:${op}`

/** Pedidos — operação manual (guia 13). Toda transição exige nota 3..1000 e expected_revision. */
async function run<A extends object>(
  orderId: Uuid,
  op: Op,
  fn: string,
  args: Omit<A, 'p_request_id'>,
): Promise<OrderOperationResult> {
  const pending = stablePending(opKey(orderId, op), args)
  try {
    const r = await rpc<A, OrderOperationResult>(fn, { ...args, p_request_id: pending.requestId } as A)
    clearPending(opKey(orderId, op))
    return r // r.replayed=true também é sucesso
  } catch (e) {
    if (e instanceof BackendError && !e.isNetwork) clearPending(opKey(orderId, op))
    throw e
  }
}

export const ordersService = {
  async listOrders(storeId: Uuid, f: OrderListFilters) {
    const pageSize = f.pageSize ?? 20
    let q = supabase
      .from('orders')
      .select(
        `id, code, status, revision, subtotal, shipping_amount, shipping_confirmed, total,
         created_at, updated_at, paid_at, shipped_at, delivered_at, cancelled_at, returned_at,
         reservation_expires_at, customer_snapshot, customer_id`,
        { count: 'exact' },
      )
      .eq('store_id', storeId)
    if (f.status?.length) q = q.in('status', f.status)
    if (f.code) q = q.ilike('code', `%${f.code.replace(/[%_]/g, '')}%`)
    if (f.customerId) q = q.eq('customer_id', f.customerId)
    if (f.from) q = q.gte('created_at', startOfDayIso(f.from))
    if (f.to) q = q.lt('created_at', startOfDayIso(addDays(f.to, 1)))
    const { data, count, error } = await q
      .order('created_at', { ascending: false })
      .order('id')
      .range((f.page - 1) * pageSize, f.page * pageSize - 1)
    if (error) throw toBackendError(error)
    return { items: (data ?? []) as OrdersRow[], total: count ?? 0, pageSize }
  },

  async getOrderDetail(orderId: Uuid): Promise<OrderDetail> {
    const [order, items, history, payments, reservations, returns] = await Promise.all([
      supabase.from('orders').select('*').eq('id', orderId).maybeSingle(),
      supabase
        .from('order_items')
        .select(
          'id, product_id, product_code, product_name, product_slug, image_path, attributes_snapshot, quantity, unit_price, unit_cost_snapshot, line_total',
        )
        .eq('order_id', orderId)
        .order('product_name'),
      supabase
        .from('order_status_history')
        .select('id, revision, event_type, status_before, status_after, note, actor_id, created_at')
        .eq('order_id', orderId)
        .order('revision'),
      supabase
        .from('order_payments')
        .select('id, kind, method, amount, external_reference, note, confirmed_by, confirmed_at')
        .eq('order_id', orderId)
        .order('confirmed_at'),
      supabase
        .from('inventory_reservations')
        .select('id, product_id, quantity, state, expires_at')
        .eq('order_id', orderId),
      supabase
        .from('order_return_items')
        .select('id, order_item_id, disposition, quantity, allocated_cost, restocked_value, loss_value, note, created_at')
        .eq('order_id', orderId),
    ])
    for (const r of [order, items, history, payments, reservations, returns]) {
      if (r.error) throw toBackendError(r.error)
    }
    return {
      order: order.data as OrdersRow | null,
      items: (items.data ?? []) as OrderItemsRow[],
      history: (history.data ?? []) as OrderStatusHistoryRow[],
      payments: (payments.data ?? []) as OrderPaymentsRow[],
      reservations: (reservations.data ?? []) as InventoryReservationsRow[],
      returns: (returns.data ?? []) as OrderReturnItemsRow[],
    }
  },

  // ---------- Transições (guia 13.4) ----------
  confirmTerms: (o: OrdersRow, shipping: number, note: string) =>
    run<UpdateOrderTermsArgs>(o.id, 'terms', 'update_order_terms', {
      p_order_id: o.id,
      p_expected_revision: o.revision,
      p_shipping_amount: shipping,
      p_note: note,
    }),

  confirmPayment: (o: OrdersRow, method: ManualMethod, note: string, reference?: string) =>
    run<ConfirmOrderPaymentArgs>(o.id, 'pay', 'confirm_order_payment', {
      p_order_id: o.id,
      p_expected_revision: o.revision,
      p_amount: o.total, // DEVE ser igual a orders.total
      p_method: method,
      p_note: note,
      p_reference: reference || null,
    }),

  ship: (o: OrdersRow, note: string, tracking?: string) =>
    run<ShipOrderArgs>(o.id, 'ship', 'ship_order', {
      p_order_id: o.id,
      p_expected_revision: o.revision,
      p_note: note,
      p_tracking_code: tracking?.trim() || null,
    }),

  deliver: (o: OrdersRow, note: string) =>
    run<DeliverOrderArgs>(o.id, 'deliver', 'deliver_order', {
      p_order_id: o.id,
      p_expected_revision: o.revision,
      p_note: note,
    }),

  cancel: (o: OrdersRow, note: string, refund?: { method: ManualMethod; reference?: string }) =>
    run<CancelOrderArgs>(
      o.id,
      'cancel',
      'cancel_order',
      o.status === 'PENDING'
        ? {
            p_order_id: o.id,
            p_expected_revision: o.revision,
            p_note: note,
            p_refund_confirmed: false,
            p_refund_method: null,
            p_refund_reference: null,
          }
        : {
            p_order_id: o.id,
            p_expected_revision: o.revision,
            p_note: note,
            p_refund_confirmed: true,
            p_refund_method: refund!.method,
            p_refund_reference: refund?.reference || null,
          },
    ),

  returnAll: (
    o: OrdersRow,
    items: ReturnOrderItem[],
    method: ManualMethod,
    note: string,
    reference?: string,
  ) =>
    run<ReturnOrderArgs>(o.id, 'return', 'return_order', {
      p_order_id: o.id,
      p_expected_revision: o.revision,
      p_items: items,
      p_goods_received: true,
      p_refund_confirmed: true,
      p_refund_method: method,
      p_note: note,
      p_refund_reference: reference || null,
    }),
}
